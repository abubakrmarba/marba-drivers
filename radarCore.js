// Radar ma'lumotlari: Supabase'dan yuklash, telefonda saqlash (offline), eng yaqin radarni topish.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabaseClient";

const CACHE_KEY = "marba_radars_v1";
export const WARN_DISTANCE_M = 700;

export function distM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Eng yaqin radar (yo'nalishni hisobga olmaydi: oddiy va ishonchli)
export function nearestRadar(radars, lat, lng) {
  let best = null, bestD = Infinity;
  for (const r of radars) {
    // tezkor filtr: ~0.02 daraja ≈ 2 km dan uzoqlarni o'tkazib yuboramiz
    if (Math.abs(r.lat - lat) > 0.02 || Math.abs(r.lng - lng) > 0.03) continue;
    const d = distM(lat, lng, r.lat, r.lng);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? { radar: best, dist: bestD } : null;
}

export async function loadCachedRadars() {
  try { const s = await AsyncStorage.getItem(CACHE_KEY); return s ? JSON.parse(s) : []; } catch (e) { return []; }
}

// Internet bo'lsa yangilaydi (1000 qatordan sahifalab), bo'lmasa keshdagini qaytaradi
export async function refreshRadars() {
  try {
    let all = [], from = 0;
    for (;;) {
      const { data, error } = await supabase.from("radarlar").select("id, lat, lng, maxspeed, kind")
        .order("id").range(from, from + 999);
      if (error) throw error;
      all = all.concat(data || []);
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(all));
    return all;
  } catch (e) {
    return loadCachedRadars();
  }
}

export async function addDriverRadar(lat, lng) {
  const { error } = await supabase.from("radarlar").insert({ lat, lng, source: "haydovchi", kind: "kamera" });
  return !error;
}