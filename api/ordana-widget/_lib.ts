// Shared server code for the Ordana widget. Files starting with "_" are not deployed as routes.

const env = (name: string) => process.env[name]?.trim() || undefined

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function origin(request: Request): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  return host ? `${proto}://${host}` : new URL(request.url).origin
}

export const callbackUrl = (request: Request) => `${origin(request)}/ordana-widget/callback`

export const HOST_KEY = /^wak_[A-Za-z0-9_-]{4,200}$/

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- Ordana entitlement API ----------
const ORDANA_API = env('ORDANA_API_URL') ?? 'https://acwpajdwtaltiwnecszq.supabase.co/functions/v1/widget-entitlements'

export const ordanaConnected = () => Boolean(env('ORDANA_WIDGET_KEY'))

/** POSTs one action to Ordana. Retries network errors, 5xx and 429 with backoff. Never logs the key. */
async function ordana(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = env('ORDANA_WIDGET_KEY')
  if (!key) throw new Error('ORDANA_WIDGET_KEY is not set')
  let lastError = 'unknown'
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(ORDANA_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-region': 'eu-north-1' },
        body: JSON.stringify(body),
      })
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`
        const retryAfter = Number(res.headers.get('retry-after'))
        await wait(Math.min(retryAfter > 0 ? retryAfter * 1000 : 300 * 3 ** attempt, 2000))
        continue
      }
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!data) throw new Error(`Ordana answered ${res.status} without JSON`)
      // A 4xx refusal (e.g. bad_attachment_key, unknown_attachment) is an answer, not an outage.
      const refusal = typeof data.reason === 'string' ? data.reason : typeof data.error === 'string' ? data.error : null
      if (!res.ok && body.action === 'check' && refusal) return { ...data, entitled: false, paywall: false, reason: refusal }
      if (!res.ok) throw new Error(`Ordana ${body.action} failed (${res.status}): ${String(data.error ?? data.reason ?? '')}`)
      return data
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Ordana')) throw e
      lastError = e instanceof Error ? e.message : String(e)
      await wait(300 * 3 ** attempt)
    }
  }
  throw new Error(`Ordana ${body.action} unreachable: ${lastError}`)
}

export type Entitlement = {
  entitled: boolean
  paywall: boolean
  sign_in_required: boolean
  reason: string | null
  checkout_url: string | null
  credit_pack_url: string | null
  manage_url: string | null
  remaining: number | null
  plan: string | null
  variant: string | null
  variant_round: string | number | null
  connected: boolean
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const httpsUrl = (v: unknown) => {
  const s = str(v)
  return s && /^https:\/\//.test(s) ? s : null
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Answers to "just asking" checks (consume: 0) are cached for cache_ttl_s; uses (consume: 1) always go to Ordana.
const askCache = new Map<string, { until: number; value: Entitlement }>()

/** Asks Ordana whether this user may use the widget on this host; consume: 1 spends one use. */
export async function checkEntitlement(hostKey: string, endUserRef: string, consume: 0 | 1): Promise<Entitlement> {
  if (!ordanaConnected()) {
    // Not connected yet: allow, count nothing.
    return {
      entitled: true,
      paywall: false,
      sign_in_required: false,
      reason: null,
      checkout_url: null,
      credit_pack_url: null,
      manage_url: null,
      remaining: null,
      plan: null,
      variant: null,
      variant_round: null,
      connected: false,
    }
  }
  const cacheKey = `${hostKey}|${endUserRef}`
  if (consume === 0) {
    const hit = askCache.get(cacheKey)
    if (hit && hit.until > Date.now()) return hit.value
  }
  const d = await ordana({ action: 'check', attachment_key: hostKey, end_user_ref: endUserRef, consume })
  const remaining = num(d.remaining) ?? num(d.free_remaining) ?? num(d.uses_remaining)
  const value: Entitlement = {
    entitled: d.entitled === true,
    paywall: d.paywall === true,
    sign_in_required: d.sign_in_required === true,
    reason: str(d.reason),
    checkout_url: httpsUrl(d.checkout_url),
    credit_pack_url: httpsUrl(d.credit_pack_url),
    manage_url: httpsUrl(d.manage_url),
    remaining,
    plan: str(d.plan),
    variant: str(d.variant),
    variant_round: str(d.variant_round) ?? num(d.variant_round),
    connected: true,
  }
  const ttl = num(d.cache_ttl_s)
  if (ttl && ttl > 0) askCache.set(cacheKey, { until: Date.now() + Math.min(ttl, 300) * 1000, value })
  else askCache.delete(cacheKey)
  return value
}

export const whoami = () => ordana({ action: 'whoami' })

// ---------- Widget session (signed, stateless; identity is the Ordana subject) ----------
const enc = new TextEncoder()

export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  )

export type Session = { sub: string; name: string | null; email: string | null; exp: number }

const SESSION_DAYS = 30

// ---------- Widget config from Ordana's whoami ----------
// The only Vercel variable is ORDANA_WIDGET_KEY. whoami supplies the OIDC client id and issuer and the
// session secret. Fetched when the instance starts and refreshed every 10 minutes; a failure isn't cached.
export type WidgetConfig = { clientId: string; issuer: string; sessionSecret: string }

let config: { at: number; value: Promise<WidgetConfig> } | null = null

export function widgetConfig(): Promise<WidgetConfig> {
  if (config && Date.now() - config.at < 600_000) return config.value
  const value = whoami().then((d) => {
    const o = (d.oidc ?? {}) as Record<string, unknown>
    const clientId = str(o.client_id)
    const issuer = httpsUrl(o.issuer)
    const sessionSecret = str(d.session_secret)
    if (!clientId || !issuer || !sessionSecret) throw new Error('whoami is missing oidc.client_id, oidc.issuer or session_secret')
    return { clientId, issuer: issuer.replace(/\/+$/, ''), sessionSecret }
  })
  const entry = { at: Date.now(), value }
  config = entry
  value.catch((e) => {
    if (config === entry) config = null
    console.error('ordana-widget config', e instanceof Error ? e.message : e)
  })
  return value
}

if (ordanaConnected()) widgetConfig().catch(() => {})

// Signed with whoami's session_secret. Never derived from ORDANA_WIDGET_KEY, so rotating the Ordana key
// never signs anyone out. Throws when the secret can't be fetched, so callers fail without signing anyone out.
async function hmacKey(): Promise<CryptoKey> {
  const { sessionSecret } = await widgetConfig()
  return crypto.subtle.importKey('raw', enc.encode(`ordana-widget-session:${sessionSecret}`), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

// ---------- Sign-in relay ----------
// The popup's callback hands the code to our server, which finishes the sign-in and parks the session
// under the OAuth state; the embed polls for it. A cookie set in the popup would never reach an embed
// on another site, and the popup's postMessage can get lost on the way through Google.
// Stored in Supabase via two SECURITY DEFINER functions (supabase/ordana-widget.sql).

export const STATE = /^[A-Za-z0-9_-]{16,128}$/

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const url = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL')
  const key = env('SUPABASE_ANON_KEY') ?? env('VITE_SUPABASE_ANON_KEY')
  if (!url || !key) throw new Error('Supabase is not configured')
  const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      // Legacy anon keys are JWTs and go in Authorization too; publishable keys go in apikey only.
      ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw Object.assign(new Error(`Supabase ${fn} failed (${res.status})`), { status: res.status })
  return res.status === 204 ? null : res.json().catch(() => null)
}

// ---------- Signed-out use counter ("3 free tries without an account") ----------
// Kept per anon ref in Supabase (supabase/ordana-widget.sql), not just in the visitor's storage.
// Mirrors FREE_TRIES in src/ordana-widget/Widget.tsx and the offer in Ordana.
export const ANON_FREE_TRIES = 3

/**
 * Takes one signed-out use. Returns the new count, null when all are used, or undefined when the counter
 * isn't installed yet (SQL not run: 404), so the widget keeps working on Ordana's count alone until it is.
 */
export async function takeAnonUse(ref: string): Promise<number | null | undefined> {
  try {
    const n = await rpc('ordana_widget_anon_take', { p_ref: ref, p_limit: ANON_FREE_TRIES })
    return typeof n === 'number' ? n : null
  } catch (e) {
    if ((e as { status?: number }).status === 404) {
      console.warn('ordana-widget: anon use counter not installed; run supabase/ordana-widget.sql')
      return undefined
    }
    throw e
  }
}

export async function giveBackAnonUse(ref: string): Promise<void> {
  await rpc('ordana_widget_anon_give_back', { p_ref: ref }).catch((e) =>
    console.error('ordana-widget anon give back', e instanceof Error ? e.message : e),
  )
}

export type Parked = { token: string; user: Record<string, unknown> } | { error: string }

export async function parkSignIn(state: string, result: Parked): Promise<void> {
  await rpc('ordana_widget_signin_put', {
    p_state: state,
    p_token: 'error' in result ? `!${result.error}` : result.token,
    p_user: 'error' in result ? {} : result.user,
  })
}

/** Returns the parked result once (it is deleted as it is read), or null while still pending. */
export async function takeSignIn(state: string): Promise<Parked | null> {
  const rows = (await rpc('ordana_widget_signin_take', { p_state: state })) as
    | { token: string; user_info: Record<string, unknown> }[]
    | null
  const row = rows?.[0]
  if (!row) return null
  return row.token.startsWith('!') ? { error: row.token.slice(1) } : { token: row.token, user: row.user_info }
}

export async function signSession(s: Omit<Session, 'exp'>): Promise<string> {
  const key = await hmacKey()
  const payload = b64url(enc.encode(JSON.stringify({ ...s, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 })))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)))
  return `${payload}.${b64url(sig)}`
}

/** undefined = no token sent; null = token sent but invalid or expired. Throws if the secret is unavailable. */
export async function readSession(request: Request): Promise<Session | null | undefined> {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return undefined
  const [payload, sig] = auth.slice(7).split('.')
  if (!payload || !sig) return null
  const key = await hmacKey()
  try {
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(payload))
    if (!ok) return null
    const s = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session
    return typeof s.sub === 'string' && s.exp > Date.now() / 1000 ? s : null
  } catch {
    return null
  }
}

// ---------- "Continue with Ordana" (OpenID Connect, code + PKCE S256) ----------
export type Oidc = { issuer: string; clientId: string; clientSecret: string | undefined }

/** Client id and issuer come from Ordana's whoami. null when the server key is missing or whoami doesn't answer. */
export async function oidcConfig(): Promise<Oidc | null> {
  // Ordana uses the widget's server key as the client secret (token endpoint only).
  const clientSecret = env('ORDANA_OIDC_CLIENT_SECRET') ?? env('ORDANA_WIDGET_KEY')
  if (!clientSecret) return null
  try {
    const { clientId, issuer } = await widgetConfig()
    return { issuer, clientId, clientSecret }
  } catch {
    return null
  }
}

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
let discovery: Promise<Discovery> | null = null

export function discover(issuer: string): Promise<Discovery> {
  discovery ??= fetch(`${issuer}/.well-known/openid-configuration`).then((r) => {
    if (!r.ok) throw new Error(`OIDC discovery failed (${r.status})`)
    return r.json() as Promise<Discovery>
  })
  discovery.catch(() => (discovery = null))
  return discovery
}

type Jwk = JsonWebKey & { kid?: string }
let jwks: { at: number; keys: Jwk[] } | null = null

async function signingKey(jwksUri: string, kid: string | undefined): Promise<Jwk | undefined> {
  const find = () => jwks?.keys.find((k) => k.kty === 'EC' && k.crv === 'P-256' && (!kid || k.kid === kid))
  // Refetch when unknown kid (key rotation) or the cache is older than an hour.
  if (!jwks || Date.now() - jwks.at > 3600_000 || !find()) {
    const r = await fetch(jwksUri)
    if (!r.ok) throw new Error(`JWKS fetch failed (${r.status})`)
    jwks = { at: Date.now(), keys: ((await r.json()) as { keys: Jwk[] }).keys ?? [] }
  }
  return find()
}

/** Verifies the ID token's ES256 signature against Ordana's JWKS, plus iss, aud, exp and nonce. */
export async function verifyIdToken(
  idToken: string,
  d: Discovery,
  clientId: string,
  nonce: string,
): Promise<Record<string, unknown> | null> {
  try {
    const [h, p, s] = idToken.split('.')
    if (!h || !p || !s) return null
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h))) as { alg?: string; kid?: string }
    if (header.alg !== 'ES256') return null
    const jwk = await signingKey(d.jwks_uri, header.kid)
    if (!jwk) return null
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64url(s), enc.encode(`${h}.${p}`))
    if (!ok) return null
    const c = JSON.parse(new TextDecoder().decode(fromB64url(p))) as Record<string, unknown>
    const aud = c.aud
    const audOk = aud === clientId || (Array.isArray(aud) && aud.includes(clientId))
    const now = Date.now() / 1000
    if (c.iss !== d.issuer || !audOk || typeof c.exp !== 'number' || c.exp <= now - 60) return null
    if (c.nonce !== nonce || typeof c.sub !== 'string') return null
    return c
  } catch {
    return null
  }
}
