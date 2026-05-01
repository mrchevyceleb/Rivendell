import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../config.ts';

export const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

export function hasSupabase(): boolean {
  return Boolean(supabase);
}

export async function readTable<T>(table: string, fallback: T): Promise<T> {
  if (!supabase) return fallback;
  const { data, error } = await supabase.from(table).select('*');
  if (error) {
    console.warn(`[supabase] ${table} read failed: ${error.message}`);
    return fallback;
  }
  return (data ?? fallback) as T;
}
