import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl,
  ActivityIndicator, Alert, Modal, TextInput,
} from "react-native";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabaseClient";
import { startBackgroundTracking, stopBackgroundTracking, loadRouteState, pushOutbox } from "../routeTracking";
import RouteMap from "./RouteMap";
import { WebView } from "react-native-webview";
import { enqueueSync, flushQueue, pendingCount, isOnline } from "../syncQueue";

const ORANGE = "#E9642B";
const YOUTUBE_URL = "https://m.youtube.com";
const DARK_BLUE = "#0F2140";
const DARK_BLUE_LIGHT = "#1B335C";

const ZONE_PROVINCES = {
  "Vodiy": ["Farg'ona", "Andijon", "Namangan"],
  "Voha": ["Xorazm", "Buxoro", "Navoiy"],
  "Toshkent": ["Toshkent"],
  "Markaziy": ["Samarqand", "Jizzax", "Sirdaryo"],
  "Janubiy": ["Qashqadaryo", "Surxondaryo"],
  "Qoraqalpog'iston": ["Qoraqalpog'iston"],
};
const ZONE_NAMES = Object.keys(ZONE_PROVINCES);

function fmt(n) { return "$" + (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function formatDate(iso) {
  try { return new Date(iso).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return iso; }
}

function formatDuration(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default function DriverMainScreen({ driverEmail, onLogout }) {
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [driverZone, setDriverZone] = useState("");
  const [driverViloyat, setDriverViloyat] = useState("");
  const [onRoute, setOnRoute] = useState(false);
  const [routeKm, setRouteKm] = useState(0);
  const [routeSpeed, setRouteSpeed] = useState(0);
  const [routeElapsed, setRouteElapsed] = useState(0);
  const [online, setOnline] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);
  const [ytMounted, setYtMounted] = useState(false);
  const [tab, setTab] = useState("mesta");
  const [loading, setLoading] = useState(true);
  const [mestalar, setMestalar] = useState([]);
  const [myLoaded, setMyLoaded] = useState([]);
  const [myPayments, setMyPayments] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [exchangeRate, setExchangeRate] = useState(12700);

  const routeStartedAtRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => { loadDriver(); loadExchangeRate(); }, []);

  async function getUid() {
    // Avval telefondagi sessiyadan olamiz (internet shart emas), bo'lmasa serverdan so'raymiz
    try {
      const { data } = await supabase.auth.getSession();
      if (data && data.session && data.session.user) return data.session.user.id;
    } catch (e) {}
    try {
      const { data } = await supabase.auth.getUser();
      return data && data.user ? data.user.id : null;
    } catch (e) {
      return null;
    }
  }

  async function loadExchangeRate() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-exchange-rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = await res.json();
      if (json.ok && json.rate) { setExchangeRate(json.rate); return; }
    } catch (e) {}
    const { data } = await supabase.from("exchange_rate").select("usd_to_som").eq("id", 1).maybeSingle();
    if (data && data.usd_to_som) setExchangeRate(Number(data.usd_to_som));
  }

  function applyRouteState(s) {
    if (!s) return;
    setRouteKm(s.km || 0);
    setRouteSpeed(s.speedKmh || 0);
    setRouteElapsed(s.startedAt ? Math.max(0, Math.floor((Date.now() - s.startedAt) / 1000)) : 0);
  }

  async function loadDriver() {
    const uid = await getUid();
    if (!uid) { setLoading(false); return; }
    const { data } = await supabase
      .from("drivers")
      .select("name, phone, hudud, viloyat, on_route, route_km")
      .eq("auth_user_id", uid)
      .maybeSingle();
    setDriverName((data && data.name) || driverEmail.split("@")[0]);
    setDriverPhone((data && data.phone) || "");
    setDriverZone((data && data.hudud) || "");
    setDriverViloyat((data && data.viloyat) || "");
    setOnRoute(!!(data && data.on_route));
    setRouteKm(Number(data && data.route_km) || 0);
    setLoading(false);

    const savedState = await loadRouteState();
    if (savedState) {
      setOnRoute(true);
      applyRouteState(savedState);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        applyRouteState(await loadRouteState());
      }, 1000);
    }
  }

  function openPhoneModal() {
    setPhoneDraft(driverPhone);
    setPhoneModalOpen(true);
  }
  async function savePhone() {
    const uid = await getUid();
    const { error } = await supabase.from("drivers").update({ phone: phoneDraft.trim() }).eq("auth_user_id", uid);
    if (error) { Alert.alert("Xatolik", error.message); return; }
    setDriverPhone(phoneDraft.trim());
    setPhoneModalOpen(false);
  }

  async function saveZone(zone) {
    const uid = await getUid();
    await supabase.from("drivers").update({ hudud: zone, viloyat: null }).eq("auth_user_id", uid);
    setDriverZone(zone);
    setDriverViloyat("");
  }
  async function saveViloyat(v) {
    const uid = await getUid();
    await supabase.from("drivers").update({ viloyat: v }).eq("auth_user_id", uid);
    setDriverViloyat(v);
  }

  async function startRoute() {
    const uid = await getUid();
    routeStartedAtRef.current = new Date().toISOString();
    setRouteKm(0);
    setRouteSpeed(0);
    setRouteElapsed(0);
    setOnRoute(true);

    // Avval joylashuvni kuzatishni boshlaymiz (internet kerak emas)
    const result = await startBackgroundTracking(uid, driverName);
    if (!result.ok) {
      Alert.alert("Xatolik", result.error || "Joylashuvni kuzatib bolmadi");
      setOnRoute(false);
      return;
    }

    // Serverga xabar berish orqada ketadi; internet bo'lmasa kuzatuv to'xtamaydi
    supabase.from("drivers").update({ on_route: true, route_km: 0, route_started_at: routeStartedAtRef.current }).eq("auth_user_id", uid).then(() => {}, () => {});
    // Oldingi yo'lning izini serverdan tozalaymiz
    supabase.from("route_points").delete().eq("driver_auth_uid", uid).then(() => {}, () => {});

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      applyRouteState(await loadRouteState());
    }, 1000);
  }

  async function endRoute() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    const uid = await getUid();
    setOnRoute(false);

    const finalState = await stopBackgroundTracking();
    // Yo'l izining qolgan nuqtalarini yuborishga urinamiz (internet bo'lmasa o'tkazib yuboriladi)
    if (finalState) { try { for (let i = 0; i < 8 && (finalState.outbox || []).length > 0; i++) { if (!(await pushOutbox(finalState))) break; } } catch (e) {} }
    const finalKm = (finalState && finalState.km) || routeKm;
    const startedIso = finalState && finalState.startedAt
      ? new Date(finalState.startedAt).toISOString()
      : routeStartedAtRef.current;

    // Natija avval telefondagi navbatga yoziladi: internet bo'lmasa ham yo'qolmaydi
    if (finalKm > 0.05) {
      await enqueueSync("route_finished", {
        driver_name: driverName, started_at: startedIso, ended_at: new Date().toISOString(), km: finalKm,
      });
    }
    await enqueueSync("driver_state", { auth_user_id: uid, fields: { on_route: false } });

    routeStartedAtRef.current = null;
    setRouteKm(0);
    setRouteSpeed(0);
    setRouteElapsed(0);
    setPendingSync(await pendingCount());

    // Internet bo'lsa darhol yuboriladi, bo'lmasa keyinroq avtomatik
    flushQueue().then((r) => setPendingSync(r.remaining), () => {});
  }

  const refresh = useCallback(async () => {
    if (!driverName) return;
    const faol = await supabase
      .from("mestalar").select("*").eq("status", "yuklanmagan")
      .order("polka", { ascending: true }).order("created_at", { ascending: true });
    setMestalar(faol.data || []);

    const loaded = await supabase
      .from("mestalar").select("*").eq("status", "yuklangan").eq("loaded_by", driverName)
      .order("loaded_at", { ascending: false }).limit(50);
    setMyLoaded(loaded.data || []);

    const pays = await supabase
      .from("payments").select("*, customers(name)").eq("driver_name", driverName)
      .order("created_at", { ascending: false }).limit(30);
    setMyPayments(pays.data || []);
  }, [driverName]);

  useEffect(() => {
    if (!driverName) return;
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [driverName, refresh]);

  useEffect(() => {
    let alive = true;
    async function tick() {
      const ok = await isOnline();
      const cnt = await pendingCount();
      if (!alive) return;
      setOnline(ok);
      setPendingSync(cnt);
      if (ok && cnt > 0) {
        const r = await flushQueue();
        if (alive) setPendingSync(r.remaining);
      }
    }
    tick();
    const id = setInterval(tick, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (tab === "profil") setYtMounted(true);
  }, [tab]);

  async function onRefresh() { setRefreshing(true); await refresh(); setRefreshing(false); }

  function confirmLoad(m) {
    Alert.alert(
      "Yuklab olish",
      `${m.customer_name} \u2014 ${m.polka}-polka, ${m.yuk_soni} ta yuk. Yuklab oldingizmi?`,
      [
        { text: "Yo'q", style: "cancel" },
        { text: "Ha", onPress: () => markLoaded(m) },
      ]
    );
  }

  async function markLoaded(m) {
    setBusyId(m.id);
    const { data, error } = await supabase
      .from("mestalar")
      .update({ status: "yuklangan", loaded_by: driverName, loaded_at: new Date().toISOString() })
      .eq("id", m.id)
      .eq("status", "yuklanmagan")
      .select("id");
    setBusyId(null);
    if (error) { Alert.alert("Xatolik", error.message); return; }
    if (!data || data.length === 0) Alert.alert("Diqqat", "Bu yuk allaqachon yuklab olingan.");
    refresh();
  }

  function handleLogout() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    supabase.auth.signOut();
    onLogout();
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={ORANGE} size="large" /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: DARK_BLUE }}>
      <Modal visible={phoneModalOpen} transparent animationType="fade" onRequestClose={() => setPhoneModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Telefon raqam</Text>
            <TextInput
              style={styles.modalInput}
              value={phoneDraft}
              onChangeText={setPhoneDraft}
              placeholder="+998 90 123 45 67"
              placeholderTextColor="#8090b0"
              keyboardType="phone-pad"
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: DARK_BLUE_LIGHT }]} onPress={() => setPhoneModalOpen(false)}>
                <Text style={styles.modalBtnText}>Bekor qilish</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: ORANGE }]} onPress={savePhone}>
                <Text style={styles.modalBtnText}>Saqlash</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>MARBA DRIVERS</Text>
      </View>

      {onRoute && (
        <View style={styles.livePanel}>
          <View style={styles.liveCol}>
            <Text style={styles.liveValue}>{routeKm.toFixed(2)}</Text>
            <Text style={styles.liveLabel}>km</Text>
          </View>
          <View style={styles.liveCol}>
            <Text style={styles.liveValue}>{Math.round(routeSpeed)}</Text>
            <Text style={styles.liveLabel}>km/soat</Text>
          </View>
          <View style={styles.liveCol}>
            <Text style={styles.liveValue}>{formatDuration(routeElapsed)}</Text>
            <Text style={styles.liveLabel}>vaqt</Text>
          </View>
        </View>
      )}

      {(!online || pendingSync > 0) && (
        <View style={[styles.syncBanner, online && { backgroundColor: ORANGE }]}>
          <Text style={styles.syncBannerText}>
            {!online ? "Offline: masofa telefonda hisoblanmoqda" : "Ma'lumot yuborilmoqda"}
            {pendingSync > 0 ? ` \u2022 yuborilmagan: ${pendingSync}` : ""}
          </Text>
        </View>
      )}

      {ytMounted && tab !== "profil" && (
        <View style={styles.ytBar}>
          <Text style={styles.ytBarText}>▶ YouTube ishlayapti</Text>
          <TouchableOpacity onPress={() => setYtMounted(false)}>
            <Text style={styles.ytBarStop}>To'xtatish</Text>
          </TouchableOpacity>
        </View>
      )}

      {ytMounted && (
        <View style={tab === "profil" ? styles.ytVisible : styles.ytHidden}>
          <WebView
            source={{ uri: YOUTUBE_URL }}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={(req) => req.url.startsWith("http")}
            style={{ flex: 1, backgroundColor: "#000" }}
          />
        </View>
      )}

      {tab === "xarita" && <RouteMap onRoute={onRoute} online={online} pending={pendingSync} />}

      {tab !== "xarita" && (
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {tab === "mesta" && (
          <View style={{ padding: 12 }}>
            <Text style={styles.sectionTitle}>Yuklanmagan mesta ({mestalar.length})</Text>
            {mestalar.length === 0 ? (
              <Text style={styles.empty}>Hozircha yuklanadigan yuk yo'q.</Text>
            ) : mestalar.map((m) => (
              <View key={m.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                    <View style={styles.polkaBadge}><Text style={styles.polkaBadgeText}>{m.polka}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{m.customer_name}</Text>
                      {m.customer_id ? <Text style={styles.muted}>ID: {m.customer_id}</Text> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.yukNum}>{m.yuk_soni}</Text>
                    <Text style={styles.muted}>yuk</Text>
                  </View>
                </View>
                <TouchableOpacity style={[styles.actionBtn, { marginTop: 10 }]} disabled={busyId === m.id} onPress={() => confirmLoad(m)}>
                  <Text style={styles.actionBtnText}>{busyId === m.id ? "..." : "Yuklab oldim"}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {tab === "tolov" && (
          <PaymentTab driverName={driverName} exchangeRate={exchangeRate} onPaid={refresh} />
        )}

        {tab === "tarix" && (
          <View style={{ padding: 12 }}>
            <Text style={styles.sectionTitle}>Yuklaganlarim ({myLoaded.length})</Text>
            {myLoaded.length === 0 ? (
              <Text style={styles.empty}>Hali yuklangan yuk yo'q.</Text>
            ) : myLoaded.map((m) => (
              <View key={m.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{m.customer_name}</Text>
                  <Text style={styles.muted}>{formatDate(m.loaded_at)}</Text>
                </View>
                <Text style={styles.itemsText}>{m.polka}-polka {"\u2022"} {m.yuk_soni} ta yuk</Text>
              </View>
            ))}

            <Text style={styles.sectionTitle}>Olgan to'lovlarim ({myPayments.length})</Text>
            {myPayments.length === 0 ? (
              <Text style={styles.empty}>Hali to'lov olinmagan.</Text>
            ) : myPayments.map((p) => (
              <View key={p.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{(p.customers && p.customers.name) || "Noma'lum mijoz"}</Text>
                  <Text style={styles.cardTitle}>{fmt(p.amount)}</Text>
                </View>
                {p.currency === "SOM" && p.original_amount ? (
                  <Text style={styles.muted}>{Number(p.original_amount).toLocaleString("en-US")} so'm</Text>
                ) : null}
                <Text style={styles.muted}>{formatDate(p.created_at)}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === "profil" && (
          <View style={{ padding: 12 }}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{driverName}</Text>
              <TouchableOpacity onPress={openPhoneModal} style={{ marginTop: 6 }}>
                <Text style={{ color: "#2C6FA6", fontSize: 13, fontWeight: "700" }}>
                  {driverPhone || "Telefon kiritish uchun bosing"}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Hudud</Text>
            <View style={styles.zoneRowLight}>
              {ZONE_NAMES.map((z) => (
                <TouchableOpacity key={z} onPress={() => saveZone(driverZone === z ? "" : z)} style={[styles.zoneChipLight, driverZone === z && styles.zoneChipActive]}>
                  <Text style={[styles.zoneChipTextLight, driverZone === z && { color: "#fff" }]}>{z}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {driverZone && (ZONE_PROVINCES[driverZone] || []).length > 1 && (
              <View style={styles.zoneRowLight}>
                {ZONE_PROVINCES[driverZone].map((v) => (
                  <TouchableOpacity key={v} onPress={() => saveViloyat(driverViloyat === v ? "" : v)} style={[styles.zoneChipLight, driverViloyat === v && styles.zoneChipActive]}>
                    <Text style={[styles.zoneChipTextLight, driverViloyat === v && { color: "#fff" }]}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>Yolda holati</Text>
            {onRoute ? (
              <TouchableOpacity onPress={endRoute} style={[styles.profileActionBtn, { backgroundColor: "#a1281f" }]}>
                <Text style={styles.profileActionBtnText}>Yolni tugatdim ({routeKm.toFixed(1)} km)</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={startRoute} style={[styles.profileActionBtn, { backgroundColor: ORANGE }]}>
                <Text style={styles.profileActionBtnText}>Yolga chiqdim</Text>
              </TouchableOpacity>
            )}


            <TouchableOpacity onPress={handleLogout} style={[styles.profileActionBtn, { backgroundColor: DARK_BLUE_LIGHT, marginTop: 20 }]}>
              <Text style={styles.profileActionBtnText}>Chiqish</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
      )}

      <View style={styles.tabBar}>
        <RoundTab emoji="📍" label="Mesta" active={tab === "mesta"} onPress={() => setTab("mesta")} badge={mestalar.length} />
        <RoundTab emoji="💵" label="To'lov" active={tab === "tolov"} onPress={() => { setTab("tolov"); loadExchangeRate(); }} />
        <RoundTab emoji="🗺" label="Xarita" active={tab === "xarita"} onPress={() => setTab("xarita")} />
        <RoundTab emoji="🕓" label="Tarix" active={tab === "tarix"} onPress={() => setTab("tarix")} />
        <RoundTab emoji="👤" label="Profil" active={tab === "profil"} onPress={() => setTab("profil")} />
      </View>
    </View>
  );
}

function RoundTab({ emoji, label, active, onPress, badge }) {
  return (
    <TouchableOpacity style={styles.roundTabWrap} onPress={onPress}>
      <View style={{ position: "relative" }}>
        <View style={[styles.roundBtn, active && styles.roundBtnActive]}>
          <Text style={{ fontSize: 18 }}>{emoji}</Text>
        </View>
        {!!badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.roundTabLabel, active && { color: ORANGE }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PaymentTab({ driverName, exchangeRate, onPaid }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim().replace(/[,()%*"]/g, "");
    if (!q || customer) { setResults([]); return; }
    const t = setTimeout(async () => {
      const filter = /^\d+$/.test(q) ? `id.ilike.${q}%,name.ilike.%${q}%` : `name.ilike.%${q}%`;
      const { data } = await supabase.from("customers").select("id, name, debt").or(filter).limit(8);
      setResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [query, customer]);

  const numAmount = Number(String(amount).replace(",", ".")) || 0;
  const usdAmount = currency === "SOM" ? numAmount / exchangeRate : numAmount;

  async function submit() {
    if (!customer) { Alert.alert("Diqqat", "Avval mijozni tanlang"); return; }
    if (!numAmount || numAmount <= 0) { Alert.alert("Diqqat", "Summani kiriting"); return; }
    setBusy(true);
    try {
      const payRes = await supabase.from("payments").insert({
        customer_id: customer.id,
        amount: usdAmount,
        seller_name: `Haydovchi: ${driverName}`,
        driver_name: driverName,
        currency,
        original_amount: numAmount,
      });
      if (payRes.error) throw new Error("To'lovni saqlashda xato: " + payRes.error.message);

      const cur = await supabase.from("customers").select("debt").eq("id", customer.id).maybeSingle();
      const currentDebt = Number((cur.data && cur.data.debt) || 0);
      const upd = await supabase.from("customers").update({ debt: Math.max(currentDebt - usdAmount, 0) }).eq("id", customer.id);
      if (upd.error) throw new Error("To'lov yozildi, lekin qarzni yangilashda xato: " + upd.error.message);

      Alert.alert("Qabul qilindi", `${customer.name}: ${fmt(usdAmount)}`);
      setCustomer(null); setQuery(""); setAmount("");
      onPaid();
    } catch (e) {
      Alert.alert("Xatolik", e.message || "Nomalum xatolik");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ padding: 12 }}>
      <Text style={styles.sectionTitle}>Mijozdan to'lov olish</Text>

      {!customer ? (
        <View style={styles.card}>
          <TextInput
            style={styles.modalInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Mijoz ID yoki ismi"
            placeholderTextColor="#8090b0"
            autoCorrect={false}
          />
          {results.map((c) => (
            <TouchableOpacity key={c.id} style={styles.searchResult} onPress={() => { setCustomer(c); setResults([]); }}>
              <Text style={styles.cardTitle}>{c.name}</Text>
              <Text style={styles.muted}>ID: {c.id} {"\u2022"} Qarz: {fmt(c.debt)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{customer.name}</Text>
              <Text style={styles.muted}>ID: {customer.id} {"\u2022"} Joriy qarz: {fmt(customer.debt)}</Text>
            </View>
            <TouchableOpacity onPress={() => { setCustomer(null); setQuery(""); }}>
              <Text style={{ color: "#2C6FA6", fontWeight: "700", fontSize: 12 }}>O'zgartirish</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 6, marginTop: 12, marginBottom: 12 }}>
            {["USD", "SOM"].map((c) => (
              <TouchableOpacity key={c} onPress={() => setCurrency(c)} style={[styles.currencyBtn, currency === c && styles.currencyBtnActive]}>
                <Text style={[styles.currencyBtnText, currency === c && { color: "#fff" }]}>{c === "USD" ? "Dollar" : "So'm"}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.modalInput}
            value={amount}
            onChangeText={setAmount}
            placeholder={currency === "USD" ? "Masalan: 100" : "Masalan: 1000000"}
            placeholderTextColor="#8090b0"
            keyboardType="numeric"
          />
          {currency === "SOM" && numAmount > 0 ? (
            <Text style={[styles.muted, { marginTop: 6 }]}>{"\u2248"} {fmt(usdAmount)} (kurs: {Math.round(exchangeRate)})</Text>
          ) : null}

          <TouchableOpacity style={[styles.actionBtn, { marginTop: 14 }]} disabled={busy} onPress={submit}>
            <Text style={styles.actionBtnText}>{busy ? "..." : "To'lovni qabul qilish"}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: DARK_BLUE },
  header: { paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: DARK_BLUE, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerTitle: { color: "#fff", fontWeight: "900", fontStyle: "italic", fontSize: 15 },
  headerKm: { color: ORANGE, fontWeight: "700", fontSize: 13 },
  livePanel: { flexDirection: "row", backgroundColor: DARK_BLUE_LIGHT, marginHorizontal: 12, marginBottom: 6, borderRadius: 12, paddingVertical: 10 },
  liveCol: { flex: 1, alignItems: "center" },
  liveValue: { color: "#fff", fontWeight: "800", fontSize: 24 },
  syncBanner: { backgroundColor: "#a1281f", marginHorizontal: 12, marginBottom: 6, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12 },
  syncBannerText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  ytVisible: { height: 300, marginHorizontal: 12, marginBottom: 8, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  ytHidden: { height: 1, opacity: 0.01, overflow: "hidden" },
  ytBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#D32F2F", marginHorizontal: 12, marginBottom: 6, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12 },
  ytBarText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  ytBarStop: { color: "#fff", fontSize: 12, fontWeight: "800", textDecorationLine: "underline" },
  liveLabel: { color: "#9FB0CC", fontSize: 10.5, fontWeight: "700", marginTop: 2, textTransform: "uppercase" },
  sectionTitle: { color: "#9FB0CC", fontWeight: "700", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginVertical: 8 },
  empty: { textAlign: "center", color: "#9FB0CC", padding: 20, fontSize: 13 },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 10, marginBottom: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontWeight: "700", fontSize: 13 },
  muted: { color: "#8a887e", fontSize: 11 },
  itemsText: { fontSize: 11.5, marginVertical: 4, color: "#333" },
  actionBtn: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  polkaBadge: { width: 44, height: 44, borderRadius: 10, backgroundColor: ORANGE, alignItems: "center", justifyContent: "center" },
  polkaBadgeText: { color: "#fff", fontWeight: "800", fontSize: 18 },
  yukNum: { fontWeight: "800", fontSize: 22, color: "#161615" },
  searchResult: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#efeee7" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 },
  modalBox: { backgroundColor: "#fff", borderRadius: 14, padding: 20 },
  modalTitle: { fontWeight: "700", fontSize: 15, marginBottom: 12 },
  modalInput: { borderWidth: 1.5, borderColor: "#d8d6cc", borderRadius: 8, padding: 12, fontSize: 14 },
  modalBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  modalBtnText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
  currencyBtn: { flex: 1, backgroundColor: "#f3f2ec", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  currencyBtnActive: { backgroundColor: ORANGE },
  currencyBtnText: { fontWeight: "700", fontSize: 12.5, color: "#161615" },
  zoneRowLight: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  zoneChipLight: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d8d6cc", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16 },
  zoneChipActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  zoneChipTextLight: { color: "#161615", fontSize: 12, fontWeight: "700" },
  profileActionBtn: { borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  profileActionBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  tabBar: { flexDirection: "row", backgroundColor: DARK_BLUE, paddingBottom: 20, paddingTop: 10 },
  roundTabWrap: { flex: 1, alignItems: "center" },
  roundBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "transparent", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  roundBtnActive: { backgroundColor: "rgba(233,100,43,0.15)", borderColor: ORANGE },
  roundTabLabel: { fontSize: 10, fontWeight: "700", color: "#9FB0CC", marginTop: 4 },
  badge: { position: "absolute", top: -4, right: -4, backgroundColor: "#E53935", borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: "#fff", fontSize: 9.5, fontWeight: "700" },
});