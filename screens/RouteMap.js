import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { loadRouteState } from "../routeTracking";
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

  let hint = null;
  if (!online) {
    hint = "Offline: yo'l va masofa hisoblanmoqda. Fon xaritasi ko'rinmasligi mumkin. Internet tiklanganda ma'lumot yuboriladi.";
  } else if (loadError) {
    hint = "Xarita yuklanmadi. Internetni tekshiring.";
  } else if (!onRoute) {
    hint = "Yo'lga chiqmagansiz, hozirgi joylashuvingiz ko'rsatilmoqda.";
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

      <View style={styles.buttons}>
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
  buttons: { position: "absolute", right: 12, bottom: 24, gap: 10 },
  roundBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
    elevation: 4, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  legend: {
    position: "absolute", left: 12, top: 12, flexDirection: "row", alignItems: "center", gap: 8,
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