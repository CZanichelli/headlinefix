import { local, session } from './storage'
import {
  GONE_REASONS,
  SignedOutError,
  type CheckResult,
  type Variant,
  type WidgetBackend,
  type WidgetUser,
} from './types'

const API = '/api/ordana-widget'
const TOKEN_KEY = 'ow_session'
const USER_KEY = 'ow_user'
const VISITOR_KEY = 'ow_visitor'
const LOAD_KEY = 'ow_load'

type CheckResponse = {
  entitled: boolean
  paywall: boolean
  sign_in_required?: boolean
  checkout_url: string | null
  credit_pack_url: string | null
  manage_url: string | null
  reason: string | null
  remaining: number | null
  plan: string | null
  variant: string | null
}

/** The random id behind "anon_…" before sign-in. Kept in storage, or for this page load when storage is blocked. */
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
    signInRequired: r.sign_in_required === true,
    checkoutUrl: r.checkout_url,
    creditPackUrl: r.credit_pack_url,
    manageUrl: r.manage_url,
    reason: r.reason,
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

export type LoadAnswer = { variant: Variant; gone: boolean }

/**
 * The one check on load (consume: 0, nothing spent): counts the impression, says which version (A/B)
 * Ordana assigned, and whether the widget is switched off on this host. Kept for the session.
 */
export async function loadCheck(hostKey: string): Promise<LoadAnswer> {
  try {
    const kept = JSON.parse(session.get(LOAD_KEY) ?? 'null') as LoadAnswer | null
    if (kept && (kept.variant === 'a' || kept.variant === 'b')) return kept
  } catch {
    /* ask again */
  }
  let answer: LoadAnswer = { variant: 'a', gone: false }
  try {
    const r = await Promise.race([check(hostKey, 0), new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))])
    if (r) {
      answer = {
        variant: r.variant === 'b' ? 'b' : 'a',
        gone: !r.entitled && r.reason !== null && GONE_REASONS.has(r.reason),
      }
    }
  } catch {
    /* fall back to version a; a failed check never hides the widget */
  }
  session.set(LOAD_KEY, JSON.stringify(answer))
  return answer
}

function randomState(): string {
  const a = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const POLL_MS = 2000
const POLL_FOR_MS = 5 * 60_000

/**
 * "Continue with Ordana": a popup on our own origin runs the OIDC redirect; our server finishes it and keeps
 * the session under `state`. We poll for it every 2s (and on focus/visibility), and the popup's message,
 * when it arrives, just makes us ask at once.
 */
function signInPopup(hostKey: string, signal?: AbortSignal): Promise<WidgetUser> {
  const state = randomState()
  const popup = window.open(
    `/ordana-widget/signin?host=${encodeURIComponent(hostKey)}&state=${state}`,
    'ordana-widget-signin',
    'popup,width=480,height=680,left=' + Math.round(screen.width / 2 - 240),
  )
  if (!popup) return Promise.reject(new Error('Your browser blocked the sign-in window. Allow pop-ups and try again.'))

  return new Promise((resolve, reject) => {
    const started = Date.now()
    let done = false
    let asking = false

    const stop = () => {
      done = true
      clearInterval(timer)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('focus', ask)
      document.removeEventListener('visibilitychange', ask)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => fail('cancelled')
    const fail = (text: string) => {
      stop()
      reject(new Error(text))
    }

    async function ask() {
      if (done || asking) return
      asking = true
      try {
        const res = await fetch(`${API}/session?state=${state}`, { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (done) return
        if (data?.status === 'done' && data.token) {
          stop()
          local.set(TOKEN_KEY, data.token)
          local.set(USER_KEY, JSON.stringify(data.user))
          resolve(data.user as WidgetUser)
        } else if (data?.status === 'error') {
          fail(errorText(data.error))
        }
      } catch {
        /* try again on the next tick */
      } finally {
        asking = false
      }
    }

    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const d = e.data as { type?: string; state?: string; error?: string } | null
      if (!d || d.type !== 'ordana-widget:signin' || d.state !== state) return
      if (d.error === 'not_configured' || d.error === 'invalid_response' || d.error === 'access_denied') fail(errorText(d.error))
      else void ask()
    }

    // No popup.closed check: once the popup passes through Google it can report closed while still open.
    // The user cancels from the widget instead.
    const timer = setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) return fail('Sign-in timed out. Please try again.')
      void ask()
    }, POLL_MS)
    signal?.addEventListener('abort', onAbort)
    window.addEventListener('message', onMessage)
    window.addEventListener('focus', ask)
    document.addEventListener('visibilitychange', ask)
  })
}

function errorText(code: unknown): string {
  if (code === 'not_configured') return 'Sign-in isn’t switched on for this widget yet.'
  if (code === 'signed_out') return 'Your Ordana sign-in was withdrawn. Please continue with Ordana again.'
  return 'Sign-in didn’t finish. Please try again.'
}

export function createLiveBackend(hostKey: string): WidgetBackend {
  return {
    currentUser() {
      if (!local.get(TOKEN_KEY)) return null
      try {
        const u = JSON.parse(local.get(USER_KEY) ?? 'null') as WidgetUser | null
        return u && typeof u.id === 'string' ? u : null
      } catch {
        return null
      }
    },
    signIn: (signal) => signInPopup(hostKey, signal),
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
