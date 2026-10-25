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
  reason: string | null
  checkout_url: string | null
  credit_pack_url: string | null
  manage_url: string | null
  remaining: number | null
  plan: string | null
  variant: string | null
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
      reason: null,
      checkout_url: null,
      credit_pack_url: null,
      manage_url: null,
      remaining: null,
      plan: null,
      variant: null,
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
    reason: str(d.reason),
    checkout_url: httpsUrl(d.checkout_url),
    credit_pack_url: httpsUrl(d.credit_pack_url),
    manage_url: httpsUrl(d.manage_url),
    remaining,
    plan: str(d.plan),
    variant: str(d.variant),
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

// Signed with ORDANA_WIDGET_SESSION_SECRET, or (by default) a key derived from ORDANA_WIDGET_KEY.
function hmacKey(): Promise<CryptoKey> | null {
  const secret = env('ORDANA_WIDGET_SESSION_SECRET') ?? env('ORDANA_WIDGET_KEY')
  if (!secret) return null
  return crypto.subtle.importKey('raw', enc.encode(`ordana-widget-session:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export const sessionConfigured = () => Boolean(env('ORDANA_WIDGET_SESSION_SECRET') ?? env('ORDANA_WIDGET_KEY'))

export async function signSession(s: Omit<Session, 'exp'>): Promise<string> {
  const key = await hmacKey()
  if (!key) throw new Error('No session secret')
  const payload = b64url(enc.encode(JSON.stringify({ ...s, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 })))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)))
  return `${payload}.${b64url(sig)}`
}

/** undefined = no token sent; null = token sent but invalid or expired. */
export async function readSession(request: Request): Promise<Session | null | undefined> {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return undefined
  const [payload, sig] = auth.slice(7).split('.')
  const key = await hmacKey()
  if (!key || !payload || !sig) return null
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

export function oidcConfig(): Oidc | null {
  const issuer = env('ORDANA_OIDC_ISSUER') ?? 'https://acwpajdwtaltiwnecszq.supabase.co/functions/v1/ordana-id'
  const clientId = env('ORDANA_OIDC_CLIENT_ID') ?? 'efea0e7b-7438-4acf-85b9-2374743d271f'
  // Ordana uses the widget's server key as the client secret (token endpoint only).
  const clientSecret = env('ORDANA_OIDC_CLIENT_SECRET') ?? env('ORDANA_WIDGET_KEY')
  if (!clientSecret) return null
  return { issuer: issuer.replace(/\/+$/, ''), clientId, clientSecret }
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
