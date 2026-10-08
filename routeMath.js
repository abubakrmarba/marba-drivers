// GPS nuqtalaridan masofa va tezlikni aniq hisoblash (toza mantiq, hech qanday bog'liqliksiz)

export const MAX_ACCURACY_M = 35;   // bundan yomon aniqlikdagi nuqta tashlab yuboriladi
export const MAX_SPEED_MS = 55;     // ~198 km/soat: undan tez "sakrash" GPS xatosi
export const STILL_SPEED_MS = 0.7;  // ~2.5 km/soat dan past tezlik = turibdi
export const MIN_MOVE_M = 6;        // tezlik ma'lum bo'lmaganda eng kam siljish
export const TRACK_MIN_STEP_M = 20; // xarita chizig'iga nuqta qo'shish qadami
export const TRACK_MAX_POINTS = 1500;

export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pushTrack(state, lat, lng) {
  if (!state.track) state.track = [];
  const t = state.track;
  const pt = [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5];
  if (t.length > 0) {
    const last = t[t.length - 1];
    if (haversineM(last[0], last[1], pt[0], pt[1]) < TRACK_MIN_STEP_M) return;
  }
  t.push(pt);
  // Serverga hali yuborilmagan nuqtalar (web appda yo'l izini ko'rsatish uchun)
  if (!state.outbox) state.outbox = [];
  state.outbox.push(pt);
  if (state.outbox.length > 4000) state.outbox = state.outbox.slice(-2000);
  if (t.length > TRACK_MAX_POINTS) {
    // juda uzun yo'lda har ikkinchi nuqtani olib tashlaymiz (boshi va oxiri qoladi)
    state.track = t.filter((_, i) => i % 2 === 0 || i === t.length - 1);
  }
}

// state: { km, prevLat, prevLng, prevTs, anchorLat, anchorLng, speedKmh, rejects }
// Holatni o'zgartiradi, o'zgarish bo'lsa true qaytaradi.
export function applyLocations(state, locations) {
  let changed = false;

  for (const loc of locations) {
    const { latitude, longitude, accuracy, speed } = loc.coords;
    const ts = loc.timestamp || Date.now();

    if (typeof accuracy === "number" && accuracy > MAX_ACCURACY_M) continue;
    if (state.prevTs && ts <= state.prevTs) continue;

    const speedMs = typeof speed === "number" && speed >= 0 ? speed : null;

    // Birinchi nuqta: faqat boshlang'ich joyni eslab qolamiz
    if (state.prevLat === null || state.prevLat === undefined) {
      state.prevLat = latitude; state.prevLng = longitude; state.prevTs = ts;
      state.anchorLat = latitude; state.anchorLng = longitude;
      state.speedKmh = 0; state.rejects = 0;
      pushTrack(state, latitude, longitude);
      changed = true;
      continue;
    }

    const dt = (ts - state.prevTs) / 1000;
    if (dt < 0.5) continue;

    const jumpM = haversineM(state.prevLat, state.prevLng, latitude, longitude);

    // GPS "sakrashi": imkonsiz tezlik
    if (jumpM / dt > MAX_SPEED_MS) {
      state.rejects = (state.rejects || 0) + 1;
      if (state.rejects < 3) continue;
      // 3 ta ketma-ket: haqiqatan ko'chgan, yangi joydan davom etamiz (masofa qo'shilmaydi)
      state.rejects = 0;
      state.prevLat = latitude; state.prevLng = longitude; state.prevTs = ts;
      state.anchorLat = latitude; state.anchorLng = longitude;
      state.speedKmh = 0;
      changed = true;
      continue;
    }
    state.rejects = 0;

    // Tezlik: telefonning o'z tezlik datchigi, bo'lmasa nuqtalardan hisoblanadi
    let speedKmh = 0;
    if (speedMs !== null) {
      speedKmh = speedMs < STILL_SPEED_MS ? 0 : speedMs * 3.6;
    } else if (jumpM >= MIN_MOVE_M && dt <= 20) {
      speedKmh = (jumpM / dt) * 3.6;
    }

    // Masofa: "tayanch nuqta"dan o'lchanadi, shuning uchun turib qolganda GPS titrashi qo'shilmaydi
    const anchorM = haversineM(state.anchorLat, state.anchorLng, latitude, longitude);
    const stillBySpeed = speedMs !== null && speedMs < STILL_SPEED_MS;
    const acc = typeof accuracy === "number" ? accuracy : 10;
    const threshold = Math.max(MIN_MOVE_M, acc * (speedMs !== null ? 2 : 3));

    if (!stillBySpeed && anchorM >= threshold) {
      state.km = (state.km || 0) + anchorM / 1000;
      state.anchorLat = latitude; state.anchorLng = longitude;
      pushTrack(state, latitude, longitude);
    }

    state.prevLat = latitude; state.prevLng = longitude; state.prevTs = ts;
    state.speedKmh = speedKmh;
    changed = true;
  }

  return changed;
}