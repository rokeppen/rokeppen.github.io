// Shared Supabase client for the tower defence game.
// The publishable key is meant to be public: access is controlled by Row Level Security
// policies in the Supabase dashboard, so make sure RLS is enabled on every table.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";

const SUPABASE_URL = "https://blwdfmlggcoyjldgipeu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_FP6viSU3csVIXaciUbphqA_VpM5cmi5";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
