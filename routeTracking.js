import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "./supabaseClient";
import { applyLocations } from "./routeMath";
import { flushQueue, pendingCount, withTimeout } from "./syncQueue";

export const LOCATION_TASK_NAME = "marba-driver-route-tracking";
const STORAGE_KEY = "marba_route_state";
const CHANNEL_ID = "route-tracking";
const NOTIFICATION_ID = "route-tracking-live";
const PUSH_EVERY_MS = 10000;   // serverga (admin xaritasi uchun) yuborish oralig'i
const NOTIF_EVERY_MS = 3000;   // xabarnomani yangilash oralig'i

function formatDuration(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export async function loadRouteState() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function saveRouteState(state) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
}

export async function clearRouteState() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

async function ensureChannel() {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Yol kuzatuvi",
      importance: Notifications.AndroidImportance.LOW,
      enableVibrate: false,
      sound: null,
    });
  } catch (e) {}
}

// Android: ilovadan chiqqanda ham ko'rinib turadigan, doimiy (yopilmaydigan) xabarnoma.
export async function updateNotification(km, speedKmh, startedAt) {
  if (Platform.OS !== "android") return;
  try {
    const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: "MARBA - Yolda",
        body: `${km.toFixed(2)} km  \u2022  ${Math.round(speedKmh)} km/soat  \u2022  ${formatDuration(elapsed)}`,
        sticky: true,
        autoDismiss: false,
        priority: Notifications.AndroidNotificationPriority.LOW,
      },
      trigger: { channelId: CHANNEL_ID },
    });
  } catch (e) {}
}

export async function dismissNotification() {
  try {
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
  } catch (e) {}
}

// Yuborilmagan yo'l nuqtalarini route_points jadvaliga yozadi. Muvaffaqiyatli bo'lsa true.
export async function pushOutbox(state) {
  const pts = (state.outbox || []).slice(0, 500);
  if (pts.length === 0 || !state.driverAuthUid) return true;
  try {
    const startedIso = new Date(state.startedAt).toISOString();
    const rows = pts.map((p) => ({ driver_auth_uid: state.driverAuthUid, started_at: startedIso, lat: p[0], lng: p[1] }));
    const res = await withTimeout(Promise.resolve(supabase.from("route_points").insert(rows)), 8000);
    if (res.error) return false;
    state.outbox = (state.outbox || []).slice(pts.length);
    // Holat boshqa chaqiruvda o'zgargan bo'lishi mumkin: so'nggi holatni o'qib, yuborilganlarni olib tashlaymiz
    const cur = await loadRouteState();
    if (cur && cur.startedAt === state.startedAt) {
      cur.outbox = (cur.outbox || []).slice(pts.length);
      await saveRouteState(cur);
    }
    return true;
  } catch (e) {
    return false;
  }
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const locations = data.locations || [];
  if (locations.length === 0) return;

  const state = await loadRouteState();
  if (!state) return; // yo'l tugagan bo'lsa e'tiborsiz

  const changed = applyLocations(state, locations);
  if (!changed) return;

  const now = Date.now();
  const doNotif = Platform.OS === "android" && now - (state.lastNotifTs || 0) >= NOTIF_EVERY_MS;
  const doPush = !!state.driverAuthUid && now - (state.lastPushTs || 0) >= PUSH_EVERY_MS;
  if (doNotif) state.lastNotifTs = now;
  if (doPush) state.lastPushTs = now;

  await saveRouteState(state);

  if (doNotif) await updateNotification(state.km || 0, state.speedKmh || 0, state.startedAt);

  if (doPush) {
    // Masofa avval telefonda saqlandi (yuqorida). Server bilan aloqa bo'lmasa shunchaki o'tkazib yuboramiz:
    // keyingi urinishda eng so'nggi qiymat yuboriladi.
    try {
      const res = await withTimeout(Promise.resolve(
        supabase.from("drivers").update({
          current_lat: state.prevLat,
          current_lng: state.prevLng,
          route_km: state.km || 0,
          on_route: true,
          route_started_at: new Date(state.startedAt).toISOString(),
          last_ping_at: new Date().toISOString(),
        }).eq("auth_user_id", state.driverAuthUid)
      ), 8000);
      // Yo'l izi: yuborilmagan nuqtalarni serverga qo'shamiz (muvaffaqiyatli bo'lsa navbatdan olib tashlaymiz)
      if (!res.error) await pushOutbox(state);
      // Aloqa bor ekan: navbatdagi (yuborilmay qolgan) yozuvlarni ham yuboramiz
      if (!res.error && (await pendingCount()) > 0) await flushQueue();
    } catch (e) {}
  }
});

export async function startBackgroundTracking(driverAuthUid, driverName) {
  const fgPerm = await Location.requestForegroundPermissionsAsync();
  if (fgPerm.status !== "granted") return { ok: false, error: "Joylashuv ruxsati berilmadi" };

  // Fon ruxsati berilmasa ham davom etamiz (xato qaytarmaymiz).
  try { await Location.requestBackgroundPermissionsAsync(); } catch (e) {}
  try { await Notifications.requestPermissionsAsync(); } catch (e) {}
  await ensureChannel();

  const startedAt = Date.now();
  await saveRouteState({
    km: 0, prevLat: null, prevLng: null, prevTs: null, anchorLat: null, anchorLng: null,
    speedKmh: 0, rejects: 0, startedAt, driverAuthUid, driverName, track: [],
  });

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
  if (alreadyStarted) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 2000,
    distanceInterval: 5,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: "MARBA Drivers",
      notificationBody: "GPS yoqilgan - yo'l kuzatilmoqda",
      notificationColor: "#E9642B",
    },
  });

  await updateNotification(0, 0, startedAt);
  return { ok: true };
}

export async function stopBackgroundTracking() {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
  if (started) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
  await dismissNotification();
  const state = await loadRouteState();
  await clearRouteState();
  return state;
}