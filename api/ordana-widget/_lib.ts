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

// ---------- Ordana entitlement check ----------
// Provisional request shape: confirm against Ordana's "Connect your server" instructions.
const ORDANA_API = env('ORDANA_API_URL') ?? 'https://platform.joinordana.com/api/widget'

export type Entitlement = {
  entitled: boolean
  paywall: boolean
  checkout_url: string | null
  credit_pack_url: string | null
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

/** Asks Ordana whether this user may use the widget on this host; consume: 1 counts a use. */
export async function checkEntitlement(hostKey: string, user: string, consume: 0 | 1): Promise<Entitlement> {
  const serverKey = env('ORDANA_WIDGET_KEY')
  if (!serverKey) {
    // Not connected to Ordana yet (before "Connect your server"): allow, count nothing.
    return {
      entitled: true,
      paywall: false,
      checkout_url: null,
      credit_pack_url: null,
      remaining: null,
      plan: null,
      variant: null,
      connected: false,
    }
  }
  const res = await fetch(`${ORDANA_API}/entitlements/check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serverKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ widget_key: hostKey, user_id: user, consume }),
  })
  if (!res.ok) throw new Error(`Ordana entitlement check failed (${res.status})`)
  const d = (await res.json()) as Record<string, unknown>
  return {
    entitled: d.entitled === true,
    paywall: d.paywall === true,
    checkout_url: httpsUrl(d.checkout_url),
    credit_pack_url: httpsUrl(d.credit_pack_url),
    remaining: typeof d.remaining === 'number' ? d.remaining : null,
    plan: str(d.plan),
    variant: str(d.variant),
    connected: true,
  }
}

// ---------- Widget session (signed, stateless; identity is the Ordana subject) ----------
const enc = new TextEncoder()

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  )

export type Session = { sub: string; name: string | null; email: string | null; exp: number }

const SESSION_DAYS = 30

function hmacKey(): Promise<CryptoKey> | null {
  const secret = env('ORDANA_WIDGET_SESSION_SECRET')
  if (!secret) return null
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export const sessionConfigured = () => Boolean(env('ORDANA_WIDGET_SESSION_SECRET'))

export async function signSession(s: Omit<Session, 'exp'>): Promise<string> {
  const key = await hmacKey()
  if (!key) throw new Error('ORDANA_WIDGET_SESSION_SECRET is not set')
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

// ---------- "Continue with Ordana" (OpenID Connect) ----------
export type Oidc = { issuer: string; clientId: string; clientSecret: string | undefined }

export function oidcConfig(): Oidc | null {
  const issuer = env('ORDANA_OIDC_ISSUER')
  const clientId = env('ORDANA_OIDC_CLIENT_ID')
  if (!issuer || !clientId) return null
  return { issuer: issuer.replace(/\/+$/, ''), clientId, clientSecret: env('ORDANA_OIDC_CLIENT_SECRET') }
}

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string }
let discovery: Promise<Discovery> | null = null

export function discover(issuer: string): Promise<Discovery> {
  discovery ??= fetch(`${issuer}/.well-known/openid-configuration`).then((r) => {
    if (!r.ok) throw new Error(`OIDC discovery failed (${r.status})`)
    return r.json() as Promise<Discovery>
  })
  discovery.catch(() => (discovery = null))
  return discovery
}

/** Reads the ID token's claims. It came straight from the token endpoint over TLS (OIDC Core 3.1.3.7). */
export function idTokenClaims(idToken: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(idToken.split('.')[1] ?? '')))
  } catch {
    return null
  }
}
