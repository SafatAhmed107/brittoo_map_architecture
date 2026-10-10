import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from './config';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  const config = getConfig();
  if (!config.supabaseUrl || !config.supabaseSecretKey) return null;

  if (!supabaseClient) {
    supabaseClient = createClient(config.supabaseUrl, config.supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return supabaseClient;
}
