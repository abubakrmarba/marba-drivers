// Oflayn navbat: internet yo'qligida yozuvlar telefonda saqlanadi, internet qaytganda serverga yuboriladi.
// Toza mantiq (React Native'ga bog'liq emas), shuning uchun alohida sinab ko'rish mumkin.

const QUEUE_KEY = "marba_sync_queue";
const MAX_ATTEMPTS = 6;

export function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export function createSyncQueue({ storage, supabase, pingUrl, apikey, fetchFn, timeoutMs = 10000, now = () => Date.now() }) {
  let flushing = false;

  async function read() {
    try {
      const raw = await storage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  async function write(list) {
    try { await storage.setItem(QUEUE_KEY, JSON.stringify(list)); } catch (e) {}
  }

  async function enqueue(type, payload) {
    const list = await read();
    list.push({ id: `${now()}-${Math.random().toString(36).slice(2, 8)}`, type, payload, attempts: 0, createdAt: now() });
    await write(list);
    return list.length;
  }

  async function pendingCount() {
    return (await read()).length;
  }

  function failure(res) {
    const status = typeof res.status === "number" ? res.status : null;
    const msg = String((res.error && res.error.message) || "");
    const retry =
      status === 0 || status === 408 || status === 429 || (status !== null && status >= 500) ||
      (status === null && /network|fetch|timeout|abort/i.test(msg));
    return { ok: false, retry, error: res.error };
  }

  async function runOp(item) {
    try {
      if (item.type === "route_finished") {
        const p = item.payload;
        // Ikki marta yozilib qolmasligi uchun avval shunday yozuv bor-yo'qligini tekshiramiz
        const exist = await withTimeout(Promise.resolve(
          supabase.from("driver_routes").select("id")
            .eq("driver_name", p.driver_name).eq("started_at", p.started_at).eq("ended_at", p.ended_at).limit(1)
        ), timeoutMs);
        if (exist.error) return failure(exist);
        if (exist.data && exist.data.length > 0) return { ok: true };

        const res = await withTimeout(Promise.resolve(
          supabase.from("driver_routes").insert({
            driver_name: p.driver_name, started_at: p.started_at, ended_at: p.ended_at, km: p.km,
          })
        ), timeoutMs);
        if (res.error) return failure(res);
        return { ok: true };
      }
      if (item.type === "driver_state") {
        const p = item.payload;
        const res = await withTimeout(Promise.resolve(
          supabase.from("drivers").update(p.fields).eq("auth_user_id", p.auth_user_id)
        ), timeoutMs);
        if (res.error) return failure(res);
        return { ok: true };
      }
      return { ok: true }; // noma'lum tur: navbatni to'sib qo'ymaslik uchun tashlab yuboramiz
    } catch (e) {
      return { ok: false, retry: true, error: e }; // tarmoq xatosi yoki vaqt tugashi
    }
  }

  async function flush() {
    if (flushing) return { sent: 0, remaining: await pendingCount(), busy: true };
    flushing = true;
    let sent = 0;
    try {
      const list = await read();
      const keep = [];
      let stop = false;
      for (const item of list) {
        if (stop) { keep.push(item); continue; }
        const r = await runOp(item);
        if (r.ok) { sent++; continue; }
        if (r.retry) { keep.push(item); stop = true; continue; } // internet yo'q: to'xtaymiz
        item.attempts = (item.attempts || 0) + 1;                // doimiy xato: bir necha urinib, keyin tashlaymiz
        if (item.attempts < MAX_ATTEMPTS) keep.push(item);
      }
      // Yuborish vaqtida yangi qo'shilgan yozuvlar yo'qolmasin
      const latest = await read();
      const known = new Set(list.map((i) => i.id));
      const added = latest.filter((i) => !known.has(i.id));
      await write(keep.concat(added));
      return { sent, remaining: keep.length + added.length };
    } finally {
      flushing = false;
    }
  }

  // Server bilan aloqa bormi? (har qanday HTTP javob = internet bor)
  async function isOnline() {
    try {
      await withTimeout(Promise.resolve(fetchFn(pingUrl, { method: "GET", headers: { apikey } })), 5000);
      return true;
    } catch (e) {
      return false;
    }
  }

  return { enqueue, pendingCount, flush, isOnline, read };
}