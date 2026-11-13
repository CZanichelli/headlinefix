import { local, session } from './storage'
import {
  GONE_REASONS,
  SignedOutError,
  WINDING_DOWN,
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
  variant_round?: string | number | null
  signin?: 'ordana' | 'host' | null
  signin_label?: string | null
  ordana_line?: string | null
  buy_label?: string | null
  maker_visible?: boolean
  host_billed?: boolean
  release_ticket?: string
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
    signin: r.signin ?? null,
    signinLabel: r.signin_label ?? null,
    ordanaLine: 'ordana_line' in r ? (r.ordana_line ?? null) : undefined,
    buyLabel: r.buy_label ?? null,
    makerVisible: r.maker_visible,
    hostBilled: r.host_billed,
    releaseTicket: r.release_ticket ?? null,
  }
}

async function check(hostKey: string, consume: 0 | 1): Promise<CheckResponse> {
  const token = local.get(TOKEN_KEY)
  const res = await fetch(`${API}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ key: hostKey, consume, visitor: visitorId() }),
  })
  const data = await res.json().catch(() => null)
  if (res.status === 401) {
    local.remove(TOKEN_KEY)
    local.remove(USER_KEY)
    throw new SignedOutError(data?.error === 'disconnected')
  }
  if (!res.ok || !data) throw new Error(data?.error ?? 'Couldn’t reach the server. Please try again.')
  return data as CheckResponse
}

export type LoadAnswer = {
  variant: Variant
  round: string | number | null
  gone: boolean
  /** host_winding_down: show nothing at all. */
  hidden?: boolean
  /** The whole answer, so the widget shows its words (signin, ordana_line, buy_label, maker_visible…) from the start. */
  check?: CheckResult
}

/** The end_user_ref the server will use: the Ordana sub once signed in, else anon_<visitor id>. */
function userRef(): string {
  if (local.get(TOKEN_KEY)) {
    try {
      const u = JSON.parse(local.get(USER_KEY) ?? 'null') as WidgetUser | null
      if (u && typeof u.id === 'string') return u.id
    } catch {
      /* fall through */
    }
  }
  return `anon_${visitorId()}`
}

/**
 * The one check on load (consume: 0, nothing spent) for the current user ref: counts the impression, says
 * which version (A/B) Ordana assigned and its variant_round, and whether the widget is switched off on this
 * host. Kept for the session per user ref, so it's asked again after sign-in (or sign-out). Only a real
 * answer is kept; a failed or slow check shows version a now and is asked again on the next load.
 */
export async function loadCheck(hostKey: string, retries = 2): Promise<LoadAnswer> {
  const ref = userRef()
  const keptKey = `${LOAD_KEY}:${ref}`
  // The host may sign its user in (identity message) while this check is in flight for the anon ref. Then the
  // answer belongs to someone else, so ask again for whoever is signed in now and show that answer's words.
  const askedForSomeoneElse = () => retries > 0 && userRef() !== ref
  try {
    const kept = JSON.parse(session.get(keptKey) ?? 'null') as LoadAnswer | null
    // An answer kept before it carried the words (no `check`) is asked again, never shown with guessed words.
    if (kept && (kept.variant === 'a' || kept.variant === 'b') && kept.check) return kept
  } catch {
    /* ask again */
  }
  try {
    const r = await Promise.race([check(hostKey, 0), new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))])
    if (askedForSomeoneElse()) return loadCheck(hostKey, retries - 1)
    if (!r) return { variant: 'a', round: null, gone: false }
    const answer: LoadAnswer = {
      // Only a version the reply named; anything else is the control.
      variant: r.variant === 'b' ? 'b' : 'a',
      round: r.variant_round ?? null,
      gone: !r.entitled && r.reason !== null && GONE_REASONS.has(r.reason),
      hidden: !r.entitled && r.reason === WINDING_DOWN,
      check: toResult(r),
    }
    session.set(keptKey, JSON.stringify(answer))
    return answer
  } catch {
    if (askedForSomeoneElse()) return loadCheck(hostKey, retries - 1)
    // A failed check never hides the widget.
    return { variant: 'a', round: null, gone: false }
  }
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

function storedUser(): WidgetUser | null {
  if (!local.get(TOKEN_KEY)) return null
  try {
    const u = JSON.parse(local.get(USER_KEY) ?? 'null') as WidgetUser | null
    return u && typeof u.id === 'string' ? u : null
  } catch {
    return null
  }
}

export type LiveBackend = WidgetBackend & {
  /** The host page posted { type: "ordana-widget:identity", token }. Ordana says who it is; null signs out. */
  hostIdentity(token: string | null): Promise<void>
}

export function createLiveBackend(hostKey: string): LiveBackend {
  const listeners = new Set<(u: WidgetUser | null) => void>()
  const notify = (u: WidgetUser | null) => listeners.forEach((l) => l(u))
  const clear = () => {
    local.remove(TOKEN_KEY)
    local.remove(USER_KEY)
  }
  let identities = 0
  // True while a host identity is being checked with Ordana, so the widget doesn't show the signed-out start meanwhile.
  let pending = false
  const watchers = new Set<(pending: boolean) => void>()
  const setPending = (p: boolean) => {
    if (pending === p) return
    pending = p
    watchers.forEach((w) => w(p))
  }

  return {
    currentUser: storedUser,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hostSigningIn: () => pending,
    watchHost(watcher) {
      watchers.add(watcher)
      return () => watchers.delete(watcher)
    },
    requestHostSignIn() {
      if (window.parent !== window) window.parent.postMessage({ type: 'ordana-widget:signin', v: 1, reason: 'needed' }, '*')
    },
    async hostIdentity(token) {
      const n = ++identities // only the latest message counts
      const before = storedUser()
      if (token === null) {
        setPending(false)
        if (before) {
          clear()
          notify(null)
        }
        return
      }
      setPending(true)
      let res: Response
      try {
        res = await fetch(`${API}/host-signin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: hostKey, token }),
        })
      } catch {
        if (n === identities) setPending(false)
        return // offline: keep whoever is signed in
      }
      const data = await res.json().catch(() => null)
      if (n !== identities) return
      setPending(false)
      if (res.ok && data?.token && typeof data.user?.id === 'string') {
        local.set(TOKEN_KEY, data.token)
        local.set(USER_KEY, JSON.stringify(data.user))
        // A different sub signs the first person out and the new one in; the same one just gets a fresh session.
        if (before?.id !== data.user.id) notify(data.user as WidgetUser)
      } else if (res.status === 401 && before) {
        // Ordana refused the host's token: whoever was signed in is no longer.
        clear()
        notify(null)
      }
    },
    signIn: (signal) => signInPopup(hostKey, signal),
    signOut: clear,
    release(ticket) {
      void fetch(`${API}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: hostKey, ticket }),
        keepalive: true,
      }).catch(() => {})
    },
    openMaker() {
      // Open the tab inside the click (no popup blocker), then point it at the one-time link once we have it.
      const home = `${window.location.origin}/`
      const tab = window.open('about:blank', '_blank')
      if (!tab) return
      tab.opener = null
      const token = local.get(TOKEN_KEY)
      if (!token) {
        tab.location.href = home
        return
      }
      fetch(`${API}/open-link`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.json().catch(() => null))
        .then((d) => (tab.location.href = typeof d?.url === 'string' ? d.url : home))
        .catch(() => (tab.location.href = home))
    },
    use: async () => toResult(await check(hostKey, 1)),
    status: async () => toResult(await check(hostKey, 0)),
    openCheckout(url) {
      window.open(url, '_blank', 'noopener')
    },
  }
}
