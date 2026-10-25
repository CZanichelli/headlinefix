import { local, session } from './storage'
import { SignedOutError, type CheckResult, type Variant, type WidgetBackend, type WidgetUser } from './types'

const API = '/api/ordana-widget'
const TOKEN_KEY = 'ow_session'
const USER_KEY = 'ow_user'
const VISITOR_KEY = 'ow_visitor'
const VARIANT_KEY = 'ow_variant'

type CheckResponse = {
  entitled: boolean
  paywall: boolean
  checkout_url: string | null
  credit_pack_url: string | null
  remaining: number | null
  plan: string | null
  variant: string | null
}

function visitorId(): string {
  let id = local.get(VISITOR_KEY)
  if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = crypto.randomUUID()
    local.set(VISITOR_KEY, id)
  }
  return id
}

function toResult(r: CheckResponse): CheckResult {
  return {
    entitled: r.entitled,
    paywall: r.paywall,
    checkoutUrl: r.checkout_url,
    creditPackUrl: r.credit_pack_url,
    remaining: r.remaining,
    plan: r.plan,
  }
}

async function check(hostKey: string, consume: 0 | 1): Promise<CheckResponse> {
  const token = local.get(TOKEN_KEY)
  const res = await fetch(`${API}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ key: hostKey, consume, visitor: visitorId() }),
  })
  if (res.status === 401) {
    local.remove(TOKEN_KEY)
    local.remove(USER_KEY)
    throw new SignedOutError()
  }
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) throw new Error(data?.error ?? 'Couldn’t reach the server. Please try again.')
  return data as CheckResponse
}

/**
 * Which version (A/B) this visitor sees. Ordana assigns it (consume: 0, nothing counted);
 * we keep it for the rest of the session. Anything unknown means version a.
 */
export async function fetchVariant(hostKey: string): Promise<Variant> {
  const kept = session.get(VARIANT_KEY)
  if (kept === 'a' || kept === 'b') return kept
  let v: Variant = 'a'
  try {
    const r = await Promise.race([
      check(hostKey, 0),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ])
    if (r?.variant === 'b') v = 'b'
  } catch {
    /* fall back to version a */
  }
  session.set(VARIANT_KEY, v)
  return v
}

/** "Continue with Ordana": a popup on our own origin runs the OIDC redirect and posts the code back. */
function signInPopup(): Promise<WidgetUser> {
  const popup = window.open(
    '/ordana-widget/signin',
    'ordana-widget-signin',
    'popup,width=480,height=680,left=' + Math.round(screen.width / 2 - 240),
  )
  if (!popup) return Promise.reject(new Error('Your browser blocked the sign-in window. Allow pop-ups and try again.'))

  return new Promise((resolve, reject) => {
    let done = false
    const finish = () => {
      done = true
      window.removeEventListener('message', onMessage)
      clearInterval(timer)
    }
    async function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const d = e.data as { type?: string; code?: string; verifier?: string; error?: string } | null
      if (!d || d.type !== 'ordana-widget:signin') return
      finish()
      if (d.error || !d.code || !d.verifier) {
        reject(
          new Error(
            d.error === 'not_configured'
              ? 'Sign-in isn’t switched on for this widget yet.'
              : 'Sign-in didn’t finish. Please try again.',
          ),
        )
        return
      }
      try {
        const res = await fetch(`${API}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: d.code, verifier: d.verifier }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.token) throw new Error(data?.error ?? 'Sign-in didn’t finish. Please try again.')
        local.set(TOKEN_KEY, data.token)
        local.set(USER_KEY, JSON.stringify(data.user))
        resolve(data.user as WidgetUser)
      } catch (err) {
        reject(err)
      }
    }
    window.addEventListener('message', onMessage)
    const timer = setInterval(() => {
      if (!popup.closed) return
      clearInterval(timer)
      // Give a just-posted message a moment to arrive before calling it cancelled.
      setTimeout(() => {
        if (done) return
        finish()
        reject(new Error('Sign-in was closed before it finished.'))
      }, 500)
    }, 400)
  })
}

export function createLiveBackend(hostKey: string): WidgetBackend {
  return {
    currentUser() {
      if (!local.get(TOKEN_KEY)) return null
      try {
        return JSON.parse(local.get(USER_KEY) ?? 'null') as WidgetUser | null
      } catch {
        return null
      }
    },
    signIn: signInPopup,
    signOut() {
      local.remove(TOKEN_KEY)
      local.remove(USER_KEY)
    },
    use: async () => toResult(await check(hostKey, 1)),
    status: async () => toResult(await check(hostKey, 0)),
    openCheckout(url) {
      window.open(url, '_blank', 'noopener')
    },
  }
}
