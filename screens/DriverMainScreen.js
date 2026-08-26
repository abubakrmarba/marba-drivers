import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl,
  ActivityIndicator, Linking, Alert, Modal, TextInput,
} from "react-native";
import * as Location from "expo-location";
import { supabase } from "../supabaseClient";

const ORANGE = "#E9642B";
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

function normalize(s) {
  return (s || "").toLowerCase().replace(/['\u2018\u2019`\u02BC]/g, "").trim();
}
function matchesProvince(customerViloyat, province) {
  return normalize(customerViloyat).includes(normalize(province));
}
function matchesZone(customerViloyat, zoneName) {
  const provinces = ZONE_PROVINCES[zoneName] || [];
  return provinces.some((p) => matchesProvince(customerViloyat, p));
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function fmt(n) { return "$" + (Number(n) || 0).toLocaleString("en-US"); }
function formatDate(iso) {
  try { return new Date(iso).toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return iso; }
}

export default function DriverMainScreen({ driverEmail, onLogout }) {
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [driverZone, setDriverZone] = useState("");
  const [driverViloyat, setDriverViloyat] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [onRoute, setOnRoute] = useState(false);
  const [routeKm, setRouteKm] = useState(0);
  const [view, setView] = useState("orders");
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState([]);
  const [mine, setMine] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");

  const watchSubRef = useRef(null);
  const lastCoordsRef = useRef(null);
  const routeStartedAtRef = useRef(null);
  const routeKmRef = useRef(0);

  useEffect(() => { loadDriver(); }, []);

  async function getUid() {
    const { data } = await supabase.auth.getUser();
    return data && data.user ? data.user.id : null;
  }

  async function loadDriver() {
    const uid = await getUid();
    if (!uid) { setLoading(false); return; }
    const { data } = await supabase
      .from("drivers")
      .select("name, phone, hudud, viloyat, on_route, route_km, is_admin")
      .eq("auth_user_id", uid)
      .maybeSingle();
    setDriverName((data && data.name) || driverEmail.split("@")[0]);
    setDriverPhone((data && data.phone) || "");
    setDriverZone((data && data.hudud) || "");
    setDriverViloyat((data && data.viloyat) || "");
    setIsAdmin(!!(data && data.is_admin));
    setOnRoute(!!(data && data.on_route));
    setRouteKm(Number(data && data.route_km) || 0);
    setLoading(false);
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
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") { Alert.alert("Ruxsat kerak", "Joylashuv ruxsati berilmadi."); return; }
    const uid = await getUid();
    lastCoordsRef.current = null;
    routeStartedAtRef.current = new Date().toISOString();
    routeKmRef.current = 0;
    setRouteKm(0);
    setOnRoute(true);
    await supabase.from("drivers").update({ on_route: true, route_km: 0 }).eq("auth_user_id", uid);

    watchSubRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 20 },
      async (pos) => {
        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        let newKm = routeKmRef.current;
        if (lastCoordsRef.current) {
          const delta = haversineKm(lastCoordsRef.current.lat, lastCoordsRef.current.lng, latitude, longitude);
          if (delta > 0.01 && delta < 2) newKm = routeKmRef.current + delta;
        }
        lastCoordsRef.current = { lat: latitude, lng: longitude };
        routeKmRef.current = newKm;
        setRouteKm(newKm);
        const currentUid = await getUid();
        supabase.from("drivers").update({
          current_lat: latitude, current_lng: longitude, route_km: newKm, last_ping_at: new Date().toISOString(),
        }).eq("auth_user_id", currentUid);
      }
    );
  }

  async function endRoute() {
    if (watchSubRef.current) { watchSubRef.current.remove(); watchSubRef.current = null; }
    const uid = await getUid();
    setOnRoute(false);
    await supabase.from("drivers").update({ on_route: false }).eq("auth_user_id", uid);
    if (routeKmRef.current > 0.05) {
      await supabase.from("driver_routes").insert({
        driver_name: driverName, started_at: routeStartedAtRef.current, ended_at: new Date().toISOString(), km: routeKmRef.current,
      });
    }
    routeStartedAtRef.current = null;
    routeKmRef.current = 0;
  }

  async function attachCustomers(orders) {
    const list = orders || [];
    const ids = [...new Set(list.map((o) => o.customer_id).filter(Boolean))];
    if (ids.length === 0) return list;
    const { data } = await supabase
      .from("customers")
      .select("id, name, viloyat, manzil, delivery_lat, delivery_lng, phone")
      .in("id", ids);
    const map = {};
    (data || []).forEach((c) => { map[c.id] = c; });
    return list.map((o) => Object.assign({}, o, { customers: map[o.customer_id] }));
  }

  const refresh = useCallback(async () => {
    if (!driverName) return;
    const availRes = await supabase.from("buyurtmalar").select("*, buyurtma_items(*)").eq("status", "yigilmoqda").order("created_at", { ascending: true });
    const availC = await attachCustomers(availRes.data);
    let filtered = availC;
    if (driverViloyat) filtered = availC.filter((o) => matchesProvince(o.customers && o.customers.viloyat, driverViloyat));
    else if (driverZone) filtered = availC.filter((o) => matchesZone(o.customers && o.customers.viloyat, driverZone));
    setAvailable(filtered);

    const mineRes = await supabase.from("buyurtmalar").select("*, buyurtma_items(*)").eq("status", "yolda").eq("driver_name", driverName).order("created_at", { ascending: true });
    setMine(await attachCustomers(mineRes.data));
  }, [driverName, driverZone, driverViloyat]);

  useEffect(() => {
    if (!driverName) return;
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [driverName, refresh]);

  async function onRefresh() { setRefreshing(true); await refresh(); setRefreshing(false); }

  async function acceptOrder(order) {
    setBusyId(order.id);
    await supabase.from("buyurtmalar").update({ status: "yolda", driver_name: driverName, driver_phone: driverPhone }).eq("id", order.id);
    setBusyId(null);
    refresh();
  }
  async function markDelivered(order) {
    setBusyId(order.id);
    await supabase.from("buyurtmalar").update({ status: "yetkazildi" }).eq("id", order.id);
    setBusyId(null);
    refresh();
  }

  function handleLogout() {
    if (watchSubRef.current) { watchSubRef.current.remove(); watchSubRef.current = null; }
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
        <TouchableOpacity onPress={openPhoneModal}>
          <Text style={styles.headerTitle}>MARBA DRIVERS</Text>
          <Text style={styles.headerSub}>
            {driverName}{driverPhone ? ` \u2022 ${driverPhone}` : " \u2022 telefon kiritish uchun bosing"}{isAdmin ? " \u2022 ADMIN" : ""}
          </Text>
        </TouchableOpacity>
        <View style={styles.zoneRow}>
          {ZONE_NAMES.map((z) => (
            <TouchableOpacity key={z} onPress={() => saveZone(driverZone === z ? "" : z)} style={[styles.zoneChip, driverZone === z && styles.zoneChipActive]}>
              <Text style={[styles.zoneChipText, driverZone === z && { color: "#fff" }]}>{z}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {driverZone && (ZONE_PROVINCES[driverZone] || []).length > 1 && (
          <View style={styles.zoneRow}>
            {ZONE_PROVINCES[driverZone].map((v) => (
              <TouchableOpacity key={v} onPress={() => saveViloyat(driverViloyat === v ? "" : v)} style={[styles.zoneChip, driverViloyat === v && styles.zoneChipActive]}>
                <Text style={[styles.zoneChipText, driverViloyat === v && { color: "#fff" }]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={() => {
            if (!isAdmin) { Alert.alert("Diqqat", "Bu bolim faqat admin uchun"); return; }
            setView(view === "admin" ? "orders" : "admin");
          }}
          style={styles.smallBtn}
        >
          <Text style={styles.smallBtnText}>{view === "admin" ? "Buyurtmalar" : "Admin"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleLogout} style={styles.smallBtn}>
          <Text style={styles.smallBtnText}>Chiqish</Text>
        </TouchableOpacity>
        {onRoute ? (
          <TouchableOpacity onPress={endRoute} style={styles.routeBtnActive}>
            <Text style={styles.routeBtnText}>Yolni tugatdim ({routeKm.toFixed(1)} km)</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={startRoute} style={styles.routeBtn}>
            <Text style={styles.routeBtnText}>Yolga chiqdim</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}>
        {view === "admin" ? (
          <AdminPanel />
        ) : (
          <View style={{ padding: 12 }}>
            {mine.length > 0 && (
              <React.Fragment>
                <Text style={styles.sectionTitle}>Yetkazayotganlarim ({mine.length})</Text>
                {mine.map((o) => <OrderCard key={o.id} order={o} action={{ label: "Yetkazildi", onPress: () => markDelivered(o), busy: busyId === o.id }} />)}
              </React.Fragment>
            )}
            <Text style={styles.sectionTitle}>Yig'ilgan buyurtmalar ({available.length})</Text>
            {available.length === 0 ? (
              <Text style={styles.empty}>Hozircha buyurtma yo'q.</Text>
            ) : available.map((o) => <OrderCard key={o.id} order={o} action={{ label: "Yuklab oldim", onPress: () => acceptOrder(o), busy: busyId === o.id }} />)}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function OrderCard(props) {
  const order = props.order;
  const action = props.action;
  const c = order.customers;
  const total = (order.buyurtma_items || []).reduce((s, it) => s + it.price * it.qty, 0);
  const itemsText = (order.buyurtma_items || []).map((it) => `${it.product_name} x${it.qty}`).join(", ");
  const mapUrl = c && c.delivery_lat && c.delivery_lng ? `https://yandex.uz/maps/?pt=${c.delivery_lng},${c.delivery_lat}&z=16&l=map` : null;

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>#{order.order_no} - {(c && c.name) || "Noma'lum"}</Text>
        <Text style={styles.cardTitle}>{fmt(total)}</Text>
      </View>
      <Text style={styles.muted}>{(c && c.viloyat) || ""}{c && c.manzil ? `, ${c.manzil}` : ""}</Text>
      <Text style={styles.itemsText}>{itemsText}</Text>
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
        {c && c.phone && (
          <TouchableOpacity onPress={() => Linking.openURL(`tel:${c.phone}`)} style={styles.ghostBtn}>
            <Text style={styles.ghostBtnText}>Qo'ng'iroq</Text>
          </TouchableOpacity>
        )}
        {mapUrl && (
          <TouchableOpacity onPress={() => Linking.openURL(mapUrl)} style={styles.ghostBtn}>
            <Text style={styles.ghostBtnText}>Xarita</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity onPress={action.onPress} disabled={action.busy} style={styles.actionBtn}>
        <Text style={styles.actionBtnText}>{action.busy ? "..." : action.label}</Text>
      </TouchableOpacity>
    </View>
  );
}

function AdminPanel() {
  const [tab, setTab] = useState("holat");
  return (
    <View style={{ padding: 12 }}>
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
        <TouchableOpacity onPress={() => setTab("holat")} style={[styles.adminTab, tab === "holat" && styles.adminTabActive]}>
          <Text style={styles.adminTabText}>Holat</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab("tarix")} style={[styles.adminTab, tab === "tarix" && styles.adminTabActive]}>
          <Text style={styles.adminTabText}>Tarix</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab("masofa")} style={[styles.adminTab, tab === "masofa" && styles.adminTabActive]}>
          <Text style={styles.adminTabText}>Masofa</Text>
        </TouchableOpacity>
      </View>
      {tab === "holat" && <AdminHolat />}
      {tab === "tarix" && <AdminTarix />}
      {tab === "masofa" && <AdminMasofa />}
    </View>
  );
}

function AdminHolat() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, []);
  async function load() {
    const { data } = await supabase.from("drivers").select("*").order("name");
    setDrivers(data || []);
    setLoading(false);
  }
  if (loading) return <Text style={styles.empty}>Yuklanmoqda...</Text>;
  return (
    <View>
      {drivers.map((d) => {
        const mapHref = d.current_lat && d.current_lng ? `https://yandex.uz/maps/?pt=${d.current_lng},${d.current_lat}&z=15&l=map` : null;
        return (
          <View key={d.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{d.name}</Text>
              <Text style={{ fontSize: 11, fontWeight: "700", color: d.on_route ? "#2c7a4b" : "#8a887e" }}>{d.on_route ? "Yolda" : "Yolda emas"}</Text>
            </View>
            <Text style={styles.muted}>{d.phone || "tel yoq"} {d.hudud ? `- ${d.hudud}${d.viloyat ? ` (${d.viloyat})` : ""}` : ""}</Text>
            <Text style={{ fontWeight: "700", fontSize: 13, marginVertical: 4 }}>Joriy masofa: {Number(d.route_km || 0).toFixed(1)} km</Text>
            {mapHref ? (
              <TouchableOpacity onPress={() => Linking.openURL(mapHref)} style={styles.ghostBtn}><Text style={styles.ghostBtnText}>Xaritada ko'rish</Text></TouchableOpacity>
            ) : <Text style={styles.muted}>Joylashuv hali yo'q</Text>}
          </View>
        );
      })}
    </View>
  );
}

function AdminTarix() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("buyurtmalar").select("order_no, driver_name, driver_phone, created_at").eq("status", "yetkazildi").order("created_at", { ascending: false }).limit(50);
      setRows(data || []);
      setLoading(false);
    })();
  }, []);
  if (loading) return <Text style={styles.empty}>Yuklanmoqda...</Text>;
  if (rows.length === 0) return <Text style={styles.empty}>Hali yetkazilgan buyurtma yo'q.</Text>;
  return (
    <View>
      {rows.map((r, i) => (
        <View key={i} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>#{r.order_no}</Text>
            <Text style={styles.muted}>{formatDate(r.created_at)}</Text>
          </View>
          <Text style={{ fontSize: 12, marginTop: 3 }}>Haydovchi: {r.driver_name || "-"}{r.driver_phone ? ` (${r.driver_phone})` : ""}</Text>
        </View>
      ))}
    </View>
  );
}

function AdminMasofa() {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("driver_routes").select("*").order("ended_at", { ascending: false }).limit(50);
      setRows(data || []);
      const t = {};
      (data || []).forEach((r) => { t[r.driver_name] = (t[r.driver_name] || 0) + Number(r.km || 0); });
      setTotals(t);
      setLoading(false);
    })();
  }, []);
  if (loading) return <Text style={styles.empty}>Yuklanmoqda...</Text>;
  return (
    <View>
      {Object.keys(totals).length > 0 && (
        <View style={styles.card}>
          <Text style={{ fontWeight: "700", fontSize: 12.5, marginBottom: 6 }}>Jami masofa (haydovchi bo'yicha)</Text>
          {Object.entries(totals).map(([name, km]) => (
            <View key={name} style={[styles.rowBetween, { marginBottom: 3 }]}>
              <Text style={{ fontSize: 12 }}>{name}</Text>
              <Text style={{ fontSize: 12, fontWeight: "700" }}>{km.toFixed(1)} km</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={styles.sectionTitle}>Yo'l tarixi</Text>
      {rows.length === 0 ? <Text style={styles.empty}>Hali yo'l tarixi yo'q.</Text> : rows.map((r) => (
        <View key={r.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{r.driver_name}</Text>
            <Text style={styles.cardTitle}>{Number(r.km || 0).toFixed(1)} km</Text>
          </View>
          <Text style={styles.muted}>{formatDate(r.ended_at)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: DARK_BLUE },
  header: { paddingTop: 50, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: DARK_BLUE },
  headerTitle: { color: "#fff", fontWeight: "900", fontStyle: "italic", fontSize: 15 },
  headerSub: { color: "#9FB0CC", fontSize: 11.5, marginTop: 2 },
  zoneRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  zoneChip: { backgroundColor: DARK_BLUE_LIGHT, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14 },
  zoneChipActive: { backgroundColor: ORANGE },
  zoneChipText: { color: "#9FB0CC", fontSize: 11.5, fontWeight: "700" },
  actionRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10, flexWrap: "wrap" },
  smallBtn: { borderWidth: 1, borderColor: DARK_BLUE_LIGHT, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  smallBtnText: { color: "#fff", fontSize: 11.5, fontWeight: "700" },
  routeBtn: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  routeBtnActive: { backgroundColor: "#a1281f", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  routeBtnText: { color: "#fff", fontSize: 11.5, fontWeight: "700" },
  sectionTitle: { color: "#9FB0CC", fontWeight: "700", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginVertical: 8 },
  empty: { textAlign: "center", color: "#9FB0CC", padding: 20, fontSize: 13 },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 10, marginBottom: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontWeight: "700", fontSize: 13 },
  muted: { color: "#8a887e", fontSize: 11 },
  itemsText: { fontSize: 11.5, marginVertical: 4, color: "#333" },
  ghostBtn: { flex: 1, backgroundColor: "#f3f2ec", borderRadius: 7, paddingVertical: 6, alignItems: "center" },
  ghostBtnText: { fontSize: 11, fontWeight: "700", color: "#161615" },
  actionBtn: { backgroundColor: ORANGE, borderRadius: 8, paddingVertical: 9, alignItems: "center" },
  actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  adminTab: { flex: 1, backgroundColor: DARK_BLUE_LIGHT, borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  adminTabActive: { backgroundColor: ORANGE },
  adminTabText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 },
  modalBox: { backgroundColor: "#fff", borderRadius: 14, padding: 20 },
  modalTitle: { fontWeight: "700", fontSize: 15, marginBottom: 12 },
  modalInput: { borderWidth: 1.5, borderColor: "#d8d6cc", borderRadius: 8, padding: 12, fontSize: 14 },
  modalBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  modalBtnText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
});
