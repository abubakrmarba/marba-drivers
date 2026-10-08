import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Keyboard, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { Vibration } from "react-native";
import { loadRouteState } from "../routeTracking";
import { loadCachedRadars, refreshRadars, nearestRadar, addDriverRadar, WARN_DISTANCE_M } from "../radarCore";
import { LEAFLET_CSS, LEAFLET_JS } from "./leafletInline";

// Xarita plitkalari manzili. OpenStreetMap'ning ochiq serveri yengil foydalanish uchun;
// foydalanuvchilar ko'payganda shu bitta qatorni boshqa provayder manziliga almashtiring.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

// Leaflet ilova ichiga joylangan, shuning uchun internet bo'lmasa ham xarita, yo'l chizig'i va joylashuv chiziladi
// (faqat fon plitkalari internet bo'lmaganda ko'rinmasligi mumkin).
const HTML = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>${LEAFLET_CSS}</style>
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: #dfe3e8; }
  .me { width: 18px; height: 18px; border-radius: 50%; background: #1E6FFF; border: 3px solid #fff;
        box-shadow: 0 0 0 0 rgba(30,111,255,0.5); animation: pulse 2s infinite; }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(30,111,255,0.5); }
    70% { box-shadow: 0 0 0 14px rgba(30,111,255,0); }
    100% { box-shadow: 0 0 0 0 rgba(30,111,255,0); }
  }
</style></head>
<body><div id="map"></div>
<script>${LEAFLET_JS}</script>
<script>
  var map = L.map('map', { zoomControl: true }).setView([41.4, 64.6], 5);
  L.tileLayer('${TILE_URL}', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);

  function post(o) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }

  // Marshrut (reja): xaritada bosilgan nuqtagacha ko'k chiziq. Yurilgan qizil yo'l uning ustida chiziladi.
  var planCasing = L.polyline([], { color: '#ffffff', weight: 11, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  var planLine = L.polyline([], { color: '#1E6FFF', weight: 6, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  var dest = null, planSeq = 0;

  window.routeTo = function (lat, lng) {
    if (typeof me === 'undefined' || !me) { post({ t: 'err', m: 'Joylashuvingiz hali aniqlanmadi' }); return; }
    var a = me.getLatLng();
    if (!dest) {
      dest = L.marker([lat, lng], { icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 30],
        html: '<div style="font-size:30px;line-height:30px">📍</div>' }) }).addTo(map);
    } else { dest.setLatLng([lat, lng]); }
    var my = ++planSeq;
    post({ t: 'loading' });
    var url = 'https://router.project-osrm.org/route/v1/driving/' + a.lng + ',' + a.lat + ';' + lng + ',' + lat + '?overview=full&geometries=geojson';
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      if (my !== planSeq) return;
      if (!j.routes || !j.routes.length) throw new Error('no');
      var r = j.routes[0];
      var pts = r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
      planCasing.setLatLngs(pts); planLine.setLatLngs(pts);
      follow = false;
      map.fitBounds(L.latLngBounds(pts), { padding: [50, 50] });
      post({ t: 'route', km: r.distance / 1000, min: r.duration / 60 });
    }).catch(function () {
      if (my !== planSeq) return;
      post({ t: 'err', m: "Marshrut qurilmadi (internet kerak yoki yo'l topilmadi)" });
    });
  };

  window.clearPlan = function () {
    planSeq++;
    planCasing.setLatLngs([]); planLine.setLatLngs([]);
    if (dest) { dest.remove(); dest = null; }
  };

  map.on('click', function (e) { window.routeTo(e.latlng.lat, e.latlng.lng); });

  // Yurilgan yo'l: oq hoshiya ustida qizil chiziq
  var casing = L.polyline([], { color: '#ffffff', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  var line = L.polyline([], { color: '#E53935', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(map);

  var me = null, startMarker = null, follow = true, firstFix = true;
  map.on('dragstart', function () { follow = false; });

  window.updateRoute = function (p) {
    if (p.reset) {
      casing.setLatLngs(p.points || []);
      line.setLatLngs(p.points || []);
    } else if (p.points && p.points.length) {
      for (var i = 0; i < p.points.length; i++) { casing.addLatLng(p.points[i]); line.addLatLng(p.points[i]); }
    }

    var all = line.getLatLngs();
    if (all.length > 0) {
      if (!startMarker) {
        startMarker = L.circleMarker(all[0], { radius: 7, color: '#ffffff', weight: 3, fillColor: '#2c7a4b', fillOpacity: 1 }).addTo(map);
      } else { startMarker.setLatLng(all[0]); }
    } else if (startMarker) { startMarker.remove(); startMarker = null; }

    if (p.pos) {
      if (!me) {
        me = L.marker(p.pos, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
      } else { me.setLatLng(p.pos); }
      if (follow) { map.setView(p.pos, firstFix ? 16 : Math.max(map.getZoom(), 15), { animate: !firstFix }); firstFix = false; }
    }
  };

  var radarLayer = L.layerGroup().addTo(map);
  window.setRadars = function (list) {
    radarLayer.clearLayers();
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      L.marker([r.lat, r.lng], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
        html: '<div style="width:26px;height:26px;border-radius:50%;background:#fff;border:3px solid #E53935;color:#E53935;font:900 11px/20px sans-serif;text-align:center">' + (r.maxspeed ? r.maxspeed : '📷') + '</div>' }) }).addTo(radarLayer);
    }
  };

  window.fitRoute = function () {
    var all = line.getLatLngs();
    if (all.length > 1) { follow = false; map.fitBounds(L.latLngBounds(all), { padding: [40, 40] }); }
  };
</script></body></html>`;

export default function RouteMap({ onRoute, online = true, pending = 0 }) {
  const webRef = useRef(null);
  const sentRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [radars, setRadars] = useState([]);
  const [warn, setWarn] = useState(null);      // {dist, maxspeed}
  const [lastPos, setLastPos] = useState(null);
  const warnedRef = useRef(null);              // qaysi radar uchun ogohlantirilgan
  const [adding, setAdding] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [plan, setPlan] = useState(null);      // {km, min} | {loading:true}

  function onWebMessage(ev) {
    try {
      const m = JSON.parse(ev.nativeEvent.data);
      if (m.t === "loading") setPlan({ loading: true });
      else if (m.t === "route") setPlan({ km: m.km, min: m.min });
      else if (m.t === "err") {
        setPlan(null);
        setAdding(m.m);
        setTimeout(() => setAdding(""), 3000);
      }
    } catch (e) {}
  }
  // Manzil qidirish: OpenStreetMap Nominatim (bepul, internet kerak). Faqat "Qidirish" bosilganda so'rov ketadi.
  async function doSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    Keyboard.dismiss();
    setSearching(true);
    try {
      const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=uz&accept-language=uz,ru&q=" + encodeURIComponent(q);
      const r = await fetch(url, { headers: { "User-Agent": "MarbaDrivers/1.0 (marba.vercel.app)" } });
      const j = await r.json();
      setResults(Array.isArray(j) ? j : []);
      if (!Array.isArray(j) || j.length === 0) { setAdding("Hech narsa topilmadi"); setTimeout(() => setAdding(""), 2500); }
    } catch (e) {
      setResults([]);
      setAdding("Qidirib bo'lmadi (internet kerak)");
      setTimeout(() => setAdding(""), 2500);
    }
    setSearching(false);
  }
  function pickResult(it) {
    const lat = parseFloat(it.lat), lng = parseFloat(it.lon);
    setResults([]);
    run("map.setView([" + lat + "," + lng + "], 15); window.routeTo(" + lat + "," + lng + ")");
  }
  function clearPlan() { setPlan(null); run("window.clearPlan()"); }

  function run(js) {
    if (webRef.current) webRef.current.injectJavaScript(js + "; true;");
  }

  // Yo'lda: har soniya joy va yo'l chizig'ini yangilaymiz (telefondagi ma'lumotdan, internet kerak emas)
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    async function tick() {
      const s = await loadRouteState();
      if (stopped || !s || s.prevLat === null || s.prevLat === undefined) return;
      const track = s.track || [];
      const pos = [s.prevLat, s.prevLng];
      let payload;
      if (sentRef.current === 0 || track.length < sentRef.current) {
        payload = { pos, reset: true, points: track };
      } else {
        payload = { pos, reset: false, points: track.slice(sentRef.current) };
      }
      sentRef.current = track.length;
      run("window.updateRoute(" + JSON.stringify(payload) + ")");
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => { stopped = true; clearInterval(id); };
  }, [ready]);

  // Yo'lda bo'lmasa: hozirgi joylashuvni ko'rsatamiz (GPS internetsiz ishlaydi)
  useEffect(() => {
    if (!ready || onRoute) return;
    sentRef.current = 0;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        run("window.updateRoute(" + JSON.stringify({ pos: [loc.coords.latitude, loc.coords.longitude], reset: true, points: [] }) + ")");
      } catch (e) {}
    })();
  }, [ready, onRoute]);

  // Radarlar: avval keshdan (offline), keyin internetdan yangilaymiz
  useEffect(() => {
    let off = false;
    loadCachedRadars().then((c) => { if (!off) setRadars(c); });
    refreshRadars().then((r) => { if (!off) setRadars(r); });
    return () => { off = true; };
  }, []);

  useEffect(() => {
    if (ready) run("window.setRadars(" + JSON.stringify(radars) + ")");
  }, [ready, radars]);

  // Joylashuv o'zgarganda eng yaqin radarni tekshiramiz
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    async function check() {
      let pos = null;
      if (onRoute) {
        const s = await loadRouteState();
        if (s && s.prevLat !== null && s.prevLat !== undefined) pos = [s.prevLat, s.prevLng];
      }
      if (!pos) {
        try {
          const l = await Location.getLastKnownPositionAsync();
          if (l) pos = [l.coords.latitude, l.coords.longitude];
        } catch (e) {}
      }
      if (stopped || !pos) return;
      setLastPos(pos);
      const n = nearestRadar(radars, pos[0], pos[1]);
      if (n && n.dist <= WARN_DISTANCE_M) {
        setWarn({ dist: Math.round(n.dist), maxspeed: n.radar.maxspeed });
        if (warnedRef.current !== n.radar.id) { warnedRef.current = n.radar.id; Vibration.vibrate([0, 300, 150, 300]); }
      } else {
        setWarn(null);
        if (!n || n.dist > WARN_DISTANCE_M * 1.5) warnedRef.current = null;
      }
    }
    check();
    const id = setInterval(check, 3000);
    return () => { stopped = true; clearInterval(id); };
  }, [ready, onRoute, radars]);

  async function reportRadar() {
    let pos = lastPos;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status === "granted") {
        const l = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        pos = [l.coords.latitude, l.coords.longitude];
      }
    } catch (e) {}
    if (!pos) { setAdding("Joylashuv topilmadi"); setTimeout(() => setAdding(""), 2500); return; }
    const ok = await addDriverRadar(pos[0], pos[1]);
    if (ok) setRadars((r) => r.concat([{ id: "n" + Date.now(), lat: pos[0], lng: pos[1], maxspeed: null }]));
    setAdding(ok ? "Radar qo'shildi ✓" : "Qo'shilmadi (internet kerak)");
    setTimeout(() => setAdding(""), 2500);
  }

  let hint = null;
  if (!online) {
    hint = "Offline: yo'l va masofa hisoblanmoqda. Fon xaritasi ko'rinmasligi mumkin. Internet tiklanganda ma'lumot yuboriladi.";
  } else if (loadError) {
    hint = "Xarita yuklanmadi. Internetni tekshiring.";
  } else if (!onRoute) {
    hint = "Yo'lga chiqmagansiz. Marshrut uchun xaritadagi istalgan joyni bosing.";
  }

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html: HTML, baseUrl: "https://marba.vercel.app/" }}
        applicationNameForUserAgent="MarbaDrivers/1.0"
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        javaScriptEnabled
        domStorageEnabled
        onMessage={onWebMessage}
        onLoadEnd={() => setReady(true)}
        onError={() => setLoadError(true)}
        style={{ flex: 1, backgroundColor: "#dfe3e8" }}
      />

      {onRoute && (
        <View style={styles.legend}>
          <View style={styles.legendLine} />
          <Text style={styles.legendText}>Yurilgan yo'l</Text>
        </View>
      )}

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Manzil qidirish (shahar, ko'cha...)"
          placeholderTextColor="#8a8f98"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={doSearch}
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity onPress={() => { setQuery(""); setResults([]); }} style={styles.searchBtn}>
            <Text style={{ fontSize: 16, color: "#555" }}>✕</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={doSearch} style={[styles.searchBtn, { backgroundColor: "#1E6FFF" }]}>
          {searching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 16 }}>🔍</Text>}
        </TouchableOpacity>
      </View>
      {results.length > 0 && (
        <View style={styles.results}>
          {results.map((it) => (
            <TouchableOpacity key={String(it.place_id)} style={styles.resultRow} onPress={() => pickResult(it)}>
              <Text style={styles.resultText} numberOfLines={2}>{it.display_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {warn && (
        <View style={styles.warn}>
          <Text style={styles.warnIcon}>📷</Text>
          <View>
            <Text style={styles.warnTitle}>Radar {warn.dist} m oldinda</Text>
            {warn.maxspeed ? <Text style={styles.warnSub}>Tezlik chegarasi: {warn.maxspeed} km/s</Text> : <Text style={styles.warnSub}>Tezlikni pasaytiring</Text>}
          </View>
        </View>
      )}
      {plan && (
        <View style={styles.plan}>
          <View style={{ flex: 1 }}>
            <Text style={styles.planTitle}>
              {plan.loading ? "Marshrut qurilmoqda..." : `Marshrut: ${plan.km.toFixed(1)} km`}
            </Text>
            {!plan.loading && (
              <Text style={styles.planSub}>
                ~{plan.min >= 60 ? `${Math.floor(plan.min / 60)} soat ${Math.round(plan.min % 60)} daq` : `${Math.max(1, Math.round(plan.min))} daqiqa`} (avtomobilda)
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={clearPlan} style={styles.planClose}>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      {adding ? <View style={styles.toast}><Text style={styles.hintText}>{adding}</Text></View> : null}

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.roundBtn} onPress={reportRadar}>
          <Text style={{ fontSize: 14, fontWeight: "900", color: "#E53935" }}>+📷</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.roundBtn}
          onPress={() => run("follow = true; if (me) { map.setView(me.getLatLng(), Math.max(map.getZoom(), 16)); }")}
        >
          <Text style={{ fontSize: 20 }}>📍</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.roundBtn} onPress={() => run("fitRoute()")}>
          <Text style={{ fontSize: 20 }}>🧭</Text>
        </TouchableOpacity>
      </View>

      {hint ? (
        <View style={[styles.hint, !online && { backgroundColor: "rgba(161,40,31,0.95)" }]}>
          <Text style={styles.hintText}>{hint}{pending > 0 ? ` (yuborilmagan: ${pending})` : ""}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    position: "absolute", left: 12, right: 12, top: 10, flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderRadius: 12, paddingLeft: 12, paddingRight: 4, height: 46, elevation: 6,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  searchInput: { flex: 1, fontSize: 14, color: "#111", paddingVertical: 0 },
  searchBtn: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  results: {
    position: "absolute", left: 12, right: 12, top: 60, backgroundColor: "#fff", borderRadius: 12, elevation: 8, overflow: "hidden",
  },
  resultRow: { paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "#eee" },
  resultText: { fontSize: 13, color: "#111" },
  plan: {
    position: "absolute", left: 12, right: 70, bottom: 84, flexDirection: "row", alignItems: "center",
    backgroundColor: "#1E6FFF", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, elevation: 6,
  },
  planTitle: { color: "#fff", fontSize: 15, fontWeight: "900" },
  planSub: { color: "#fff", fontSize: 12, fontWeight: "600" },
  planClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.25)", alignItems: "center", justifyContent: "center", marginLeft: 8 },
  warn: {
    position: "absolute", left: 12, right: 12, top: 116, flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#E53935", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, elevation: 6,
  },
  warnIcon: { fontSize: 26 },
  warnTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  warnSub: { color: "#fff", fontSize: 12, fontWeight: "600" },
  toast: { position: "absolute", alignSelf: "center", top: 180, backgroundColor: "rgba(15,33,64,0.95)", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  buttons: { position: "absolute", right: 12, bottom: 24, gap: 10 },
  roundBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
    elevation: 4, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  legend: {
    position: "absolute", left: 12, top: 64, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(15,33,64,0.9)", borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10,
  },
  legendLine: { width: 22, height: 5, borderRadius: 3, backgroundColor: "#E53935" },
  legendText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  hint: {
    position: "absolute", left: 12, right: 70, bottom: 24, backgroundColor: "rgba(15,33,64,0.92)",
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
  },
  hintText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});