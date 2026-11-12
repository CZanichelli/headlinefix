import {
  ANON_FREE_TRIES,
  checkEntitlement,
  giveBackAnonUse,
  HOST_KEY,
  json,
  ordanaConnected,
  readJson,
  readSession,
  takeAnonUse,
  type Entitlement,
} from './_lib.js'

const VISITOR = /^[A-Za-z0-9-]{8,64}$/
const DISCONNECTED = new Set(['consent_withdrawn', 'unknown_ordana_id'])

/**
 * A signed-out rewrite: our own count of the 3 free tries (per anon ref, server-side) comes first, then
 * Ordana's consume: 1 check exactly as for everyone else. A try Ordana refuses (or that errors) is given back.
 */
async function anonUse(key: string, ref: string): Promise<Entitlement> {
  const taken = await takeAnonUse(ref)
  if (taken === null) {
    // All 3 used: the sign-in step ("Continue with Ordana") instead of a rewrite. Ordana isn't asked, nothing is spent.
    return {
      entitled: false,
      paywall: false,
      sign_in_required: true,
      reason: 'anon_free_tries_used',
      checkout_url: null,
      credit_pack_url: null,
      manage_url: null,
      remaining: 0,
      plan: null,
      variant: null,
      variant_round: null,
      // Unknown here (Ordana isn't asked): the embed keeps the sign-in kind from its load check.
      signin: null,
      signin_label: null,
      connected: true,
    }
  }
  let r: Entitlement
  try {
    r = await checkEntitlement(key, ref, 1)
  } catch (e) {
    await giveBackAnonUse(ref)
    throw e
  }
  if (!r.entitled) {
    await giveBackAnonUse(ref)
    return r
  }
  const left = ANON_FREE_TRIES - taken
  return { ...r, remaining: r.remaining === null ? left : Math.min(r.remaining, left) }
}

/**
 * POST /api/ordana-widget/check { key, consume: 0|1, visitor }
 * Asks Ordana before every use (consume: 1, signed in or not) and on load for the A/B version (consume: 0).
 * Signed out, we count the 3 free tries ourselves (anonUse); Ordana enforces the rest, asks for sign-in and
 * returns the paywall.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  const key = typeof body?.key === 'string' ? body.key : ''
  const consume = body?.consume === 1 ? 1 : 0
  const visitor = typeof body?.visitor === 'string' && VISITOR.test(body.visitor) ? body.visitor : null
  if (!HOST_KEY.test(key)) return json({ error: 'This widget is missing its key.' }, 400)

  try {
    // Throws (→ 502, not signed_out) when the session secret can't be fetched from Ordana.
    const session = await readSession(request)
    if (session === null) return json({ error: 'signed_out' }, 401)

    // end_user_ref: the Ordana "sub" (oid_…) when signed in, else "anon_" + this visitor's random id. Nothing else.
    const endUserRef = session ? session.sub : visitor ? `anon_${visitor}` : null
    if (!endUserRef) return json({ error: 'Missing visitor.' }, 400)

    if (!session && consume === 1 && ordanaConnected()) return json(await anonUse(key, endUserRef))

    const r = await checkEntitlement(key, endUserRef, consume)
    // They disconnected this widget in their Ordana account: end our session (the embed drops its token on 401)
    // so the widget offers "Continue with Ordana" again.
    if (session && r.reason && DISCONNECTED.has(r.reason)) return json({ error: 'disconnected' }, 401)
    return json(r)
  } catch (e) {
    // Fail closed: no rewrite without an answer from Ordana.
    const detail = e instanceof Error ? e.message : String(e)
    console.error('ordana-widget check', detail)
    return json({ error: 'Couldn’t check your free rewrites. Please try again.', detail }, 502)
  }
}
