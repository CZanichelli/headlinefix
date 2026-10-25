import { supabase } from '../../lib/supabase'

export const FREE_ANON_LIMIT = 3
export const FREE_MONTHLY_LIMIT = 20

const KEY = 'headlinefix_anon_uses'

export function getAnonUses(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0
  } catch {
    return 0
  }
}

export function incrementAnonUses(): number {
  const n = getAnonUses() + 1
  try {
    localStorage.setItem(KEY, String(n))
  } catch {
    /* storage unavailable */
  }
  return n
}

/** Start of the current calendar month in UTC (matches schema.sql). */
function monthStartIso(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

export async function getMonthlyUses(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', monthStartIso())
  if (error) throw error
  return count ?? 0
}

export async function recordUse(userId: string): Promise<void> {
  const { error } = await supabase.from('usage_events').insert({ user_id: userId })
  if (error) throw error
}
