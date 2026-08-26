import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://gbtqoqcvcgxueienqusn.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_XdmBMicSzJZoXzBbxUnjQw_Bd5DX1wD";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
