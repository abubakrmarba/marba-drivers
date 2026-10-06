import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient";
import { createSyncQueue, withTimeout } from "./syncCore";

const queue = createSyncQueue({
  storage: AsyncStorage,
  supabase,
  pingUrl: `${SUPABASE_URL}/auth/v1/health`,
  apikey: SUPABASE_ANON_KEY,
  fetchFn: (url, opts) => fetch(url, opts),
});

export const enqueueSync = queue.enqueue;
export const flushQueue = queue.flush;
export const pendingCount = queue.pendingCount;
export const isOnline = queue.isOnline;
export { withTimeout };