import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { rewriteHeadline, type Rewrite } from '../features/rewrite'
import { local } from './storage'
import type { Look } from './theme'
import {
  GONE_REASONS,
  isHostUser,
  NO_BRIDGE,
  SignedOutError,
  type CheckResult,
  type HostBridge,
  type Mode,
  type Variant,
  type WidgetBackend,
  type WidgetUser,
} from './types'

export type Phase = 'idle' | 'checking' | 'results' | 'gate' | 'paywall' | 'blocked' | 'gone' | 'error'
export type Panel = null | 'menu' | 'billing' | 'settings' | 'help'

/** Starting state; the preview uses it to show each screen. */
export type WidgetInitial = {
  headline?: string
  audience?: string
  phase?: Phase
  remaining?: number | null
  checkoutUrl?: string | null
  panel?: Panel
  error?: string
}

const TITLE = 'Headline rewriter'
const AUDIENCE_KEY = 'ow_default_audience'
const ORDANA_ACCOUNT = 'https://ordana.me'
const ORDANA_BILLING = 'https://ordana.me/billing'

// Mirrors the offer set in Ordana: 3 tries without an account, then 20 more free (once, no reset).
const FREE_TRIES = 3
const FREE_WITH_ACCOUNT = 20

const COPY: Record<Variant, { description: string; button: string }> = {
  a: { description: 'Get three sharper versions of any headline.', button: 'Rewrite it' },
  b: { description: 'Paste a headline. Get three better ones.', button: 'Fix my headline' },
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const shareKey = (user: WidgetUser | null) => `ow_share_${user?.id ?? 'anon'}`
type Consent = 'yes' | 'no' | null
const readConsent = (user: WidgetUser | null): Consent => {
  const v = local.get(shareKey(user))
  return v === 'yes' || v === 'no' ? v : null
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Cross-origin frames often lack clipboard-write; fall back to a selection copy.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** The shared outer frame: top bar + body. Also used for the "no key" and loading states. */
export function WidgetFrame({
  look,
  mode,
  menuButton,
  children,
}: {
  look: Look
  mode: Mode
  menuButton?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className="ow-root"
      data-theme={look.theme}
      data-mode={mode}
      data-framed={look.framed}
      data-fill={look.fill}
      style={look.vars as CSSProperties}
    >
      <div className="ow-inner">
        <header className="ow-bar">
          <div className="ow-bar-text">
            <h2 className="ow-title">{TITLE}</h2>
            {look.host && <p className="ow-small ow-muted">Found via {look.host}</p>}
          </div>
          {menuButton}
        </header>
        <div className="ow-content">{children}</div>
      </div>
    </div>
  )
}

/** "Not available here any more": the host removed the widget, or it was switched off. */
export function GoneNotice() {
  return (
    <section className="ow-panel" role="status">
      <p className="ow-strong">Not available here any more</p>
      <p className="ow-small ow-muted">This tool has been switched off on this site.</p>
    </section>
  )
}

type Props = {
  backend: WidgetBackend
  variant: Variant
  mode: Mode
  look: Look
  bridge?: HostBridge
  initial?: WidgetInitial
  /** Called after sign-in or sign-out (the user ref changed), e.g. to ask Ordana for this user's version. */
  onUserChange?: () => void
  /** From the load check: this host signs people in itself, with this label. null = Continue with Ordana. */
  signin?: { label: string } | null
}

export default function Widget({
  backend,
  variant,
  mode,
  look,
  bridge = NO_BRIDGE,
  initial = {},
  onUserChange,
  signin = null,
}: Props) {
  const [user, setUser] = useState<WidgetUser | null>(() => backend.currentUser())
  // Host sign-in: show the host's signin_label and ask the host page, never "Continue with Ordana".
  const [hostSignin, setHostSignin] = useState(signin)
  const signinProp = signin?.label ?? null
  useEffect(() => setHostSignin(signinProp === null ? null : { label: signinProp }), [signinProp])
  // What to run once the host has signed someone in (e.g. the rewrite that asked for sign-in).
  const afterHostSignIn = useRef<(() => void | Promise<void>) | null>(null)
  const userId = user?.id ?? null
  const seenUser = useRef(userId)
  const onUserChangeRef = useRef(onUserChange)
  onUserChangeRef.current = onUserChange
  useEffect(() => {
    if (seenUser.current === userId) return
    seenUser.current = userId
    onUserChangeRef.current?.()
  }, [userId])
  const [headline, setHeadline] = useState(initial.headline ?? '')
  const [audience, setAudience] = useState(() => initial.audience ?? local.get(AUDIENCE_KEY) ?? '')
  const [showAudience, setShowAudience] = useState(variant === 'a' || Boolean(initial.audience))
  // The version can change after sign-in; version a always shows the audience field.
  useEffect(() => {
    if (variant === 'a') setShowAudience(true)
  }, [variant])
  const [phase, setPhase] = useState<Phase>(initial.phase ?? 'idle')
  const [results, setResults] = useState<Rewrite[]>(() =>
    initial.phase === 'results' ? rewriteHeadline(initial.headline ?? '', initial.audience ?? '') : [],
  )
  const [remaining, setRemaining] = useState<number | null>(initial.remaining ?? null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(initial.checkoutUrl ?? null)
  const [error, setError] = useState<string | null>(initial.error ?? null)
  const [panel, setPanel] = useState<Panel>(initial.panel ?? null)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [awaitingPayment, setAwaitingPayment] = useState(false)
  // Signed out because they disconnected the widget in Ordana: the sign-in step says so instead of "free tries used".
  const [reconnect, setReconnect] = useState(false)
  const [consent, setConsent] = useState<Consent>(() => readConsent(user))
  // Which fields hold a value the host sent (shown with "From <host>"), and whether the user said "Don't use".
  const [prefilled, setPrefilled] = useState({ headline: false, audience: false })
  const [ignoreHost, setIgnoreHost] = useState(false)
  const signInAbort = useRef<AbortController | null>(null)
  const copy = COPY[variant]
  const hostName = look.host ?? 'this site'

  useEffect(() => setConsent(readConsent(user)), [user])

  // Host context only PREFILLS. It never runs a rewrite; the user still clicks.
  const ctx = bridge.context
  useEffect(() => {
    if (!ctx || ignoreHost) return
    const next = { headline: false, audience: false }
    if (ctx.draft_title) {
      setHeadline((h) => (h.trim() ? h : ctx.draft_title!))
      next.headline = true
    }
    if (ctx.audience) {
      setAudience(ctx.audience)
      setShowAudience(true)
      next.audience = true
    }
    setPrefilled((p) => ({ headline: p.headline || next.headline, audience: p.audience || next.audience }))
  }, [ctx, ignoreHost])

  function dontUseHost() {
    if (prefilled.headline && headline === ctx?.draft_title) setHeadline('')
    if (prefilled.audience && audience === ctx?.audience) setAudience(local.get(AUDIENCE_KEY) ?? '')
    setPrefilled({ headline: false, audience: false })
    setIgnoreHost(true)
  }

  function saveConsent(v: 'yes' | 'no') {
    local.set(shareKey(user), v)
    setConsent(v)
  }

  function applyCheck(r: CheckResult) {
    setRemaining(r.remaining)
    setCheckoutUrl(r.checkoutUrl ?? r.creditPackUrl)
    if (r.signin === 'host') setHostSignin({ label: r.signinLabel ?? 'Sign in' })
    else if (r.signin === 'ordana') setHostSignin(null)
  }

  function askHost(then?: () => void | Promise<void>) {
    afterHostSignIn.current = then ?? null
    backend.requestHostSignIn?.()
  }

  // The host signed someone in or out from outside the widget. A different person replaces the first.
  useEffect(
    () =>
      backend.subscribe?.((u) => {
        setUser(u)
        setReconnect(false)
        setSignInError(null)
        const then = afterHostSignIn.current
        afterHostSignIn.current = null
        setRemaining(null)
        setResults([])
        setPanel(null)
        if (u && then) void then()
        else setPhase('idle')
      }),
    [backend],
  )

  async function runUse(signedIn = user !== null) {
    setPhase('checking')
    setError(null)
    try {
      const r = await backend.use()
      applyCheck(r)
      if (r.entitled) {
        setResults(rewriteHeadline(headline, audience))
        setAwaitingPayment(false)
        setPhase('results')
      } else if (r.reason && GONE_REASONS.has(r.reason)) {
        setPhase('gone')
      } else if (r.signInRequired && !signedIn) {
        setPhase(r.paywall ? 'paywall' : 'gate')
        // The host signs people in: tell it someone needs to, then run this rewrite once they're in.
        if (r.signin === 'host' || (r.signin == null && hostSignin)) askHost(() => runUse(true))
      } else if (r.paywall && (r.checkoutUrl || r.creditPackUrl)) {
        setPhase('paywall')
      } else {
        setPhase('blocked')
      }
    } catch (e) {
      if (e instanceof SignedOutError) {
        signedOut(e)
        setPhase(e.disconnected ? 'gate' : 'idle')
        return
      }
      setError(message(e))
      setPhase('error')
    }
  }

  /** Our session is already dropped (the backend did it); update what the widget shows. */
  function signedOut(e: SignedOutError) {
    setUser(null)
    setRemaining(null)
    setReconnect(e.disconnected)
  }

  function signIn(then?: () => void | Promise<void>) {
    setSignInError(null)
    setSigningIn(true)
    const abort = new AbortController()
    signInAbort.current = abort
    // backend.signIn() opens its popup before any await, so it stays inside the click.
    backend
      .signIn(abort.signal)
      .then(async (u) => {
        setUser(u)
        setReconnect(false)
        await then?.()
      })
      .catch((e) => {
        if (!abort.signal.aborted) setSignInError(message(e))
      })
      .finally(() => {
        if (signInAbort.current === abort) signInAbort.current = null
        setSigningIn(false)
      })
  }

  function cancelSignIn() {
    signInAbort.current?.abort()
  }

  function signOut() {
    backend.signOut()
    setUser(null)
    setRemaining(null)
    setResults([])
    setPhase('idle')
    setPanel(null)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!headline.trim() || phase === 'checking') return
    void runUse()
  }

  function upgrade() {
    if (!checkoutUrl) return
    backend.openCheckout(checkoutUrl)
    setAwaitingPayment(true)
  }

  const menuButton = (
    <button
      type="button"
      className="ow-icon-btn"
      aria-label={panel ? 'Close menu' : 'Open menu'}
      aria-expanded={panel !== null}
      onClick={() => setPanel(panel ? null : 'menu')}
    >
      {panel ? (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" fill="currentColor" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
          <circle cx="13" cy="8" r="1.4" fill="currentColor" />
        </svg>
      )}
    </button>
  )

  // After sign-in, `then` runs with the new user already set, so it must not read `user` from this render.
  const continueButton = (label: string, then?: () => void | Promise<void>) =>
    hostSignin ? (
      <button type="button" className="ow-btn ow-btn-primary" onClick={() => askHost(then)}>
        {hostSignin.label}
      </button>
    ) : signingIn ? (
      <div className="ow-inline">
        <button type="button" className="ow-btn ow-btn-primary" disabled>
          Waiting for sign-in…
        </button>
        <button type="button" className="ow-link ow-small" onClick={cancelSignIn}>
          Cancel
        </button>
      </div>
    ) : (
      <button type="button" className="ow-btn ow-btn-primary" onClick={() => signIn(then)}>
        {label}
      </button>
    )

  const fromHost = (
    <span className="ow-tag" title={`Filled in from ${hostName}. You can change it.`}>
      From {hostName}
    </span>
  )

  const shareOn = bridge.canSend && consent === 'yes'

  return (
    <WidgetFrame look={look} mode={mode} menuButton={menuButton}>
      {panel === null ? (
        phase === 'gone' ? (
          <GoneNotice />
        ) : (
          <div className="ow-stack">
            <p className="ow-muted">{copy.description}</p>

            <form onSubmit={onSubmit} className="ow-form" data-variant={variant}>
              <div className="ow-fields">
                <div className="ow-field ow-field-headline">
                  <div className="ow-label-row">
                    <label htmlFor="ow-headline">Your headline</label>
                    {prefilled.headline && fromHost}
                  </div>
                  <div className="ow-row">
                    <input
                      id="ow-headline"
                      className="ow-input"
                      value={headline}
                      onChange={(e) => setHeadline(e.target.value)}
                      placeholder="e.g. Our new app helps you track expenses"
                      autoComplete="off"
                      maxLength={200}
                      required
                    />
                    {variant === 'b' && (
                      <button className="ow-btn ow-btn-primary ow-btn-bold" disabled={phase === 'checking'}>
                        {copy.button}
                      </button>
                    )}
                  </div>
                </div>
                {showAudience ? (
                  <div className="ow-field">
                    <div className="ow-label-row">
                      <label htmlFor="ow-audience">
                        Who is it for?{' '}
                        {!prefilled.audience && <span className="ow-muted ow-normal">(optional)</span>}
                      </label>
                      {prefilled.audience && fromHost}
                    </div>
                    <input
                      id="ow-audience"
                      className="ow-input"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      placeholder="e.g. freelancer"
                      autoComplete="off"
                      maxLength={80}
                    />
                  </div>
                ) : (
                  <button type="button" className="ow-link ow-small ow-start" onClick={() => setShowAudience(true)}>
                    + Add audience
                  </button>
                )}
              </div>
              {(prefilled.headline || prefilled.audience) && (
                <p className="ow-small ow-muted">
                  Filled in from {hostName}.{' '}
                  <button type="button" className="ow-link" onClick={dontUseHost}>
                    Don&apos;t use
                  </button>
                </p>
              )}
              {variant === 'a' && (
                <button className="ow-btn ow-btn-primary ow-submit" disabled={phase === 'checking'}>
                  {copy.button}
                </button>
              )}
            </form>

            {phase === 'idle' && !user && (
              <p className="ow-small ow-muted">
                {FREE_TRIES} free tries, no account needed. Already have an account?{' '}
                {hostSignin ? (
                  <button type="button" className="ow-link" onClick={() => askHost()}>
                    {hostSignin.label}
                  </button>
                ) : (
                <button type="button" className="ow-link" onClick={() => signIn()} disabled={signingIn}>
                  {signingIn ? 'Waiting for sign-in…' : 'Sign in'}
                </button>
                )}
                {signingIn && (
                  <>
                    {' '}
                    <button type="button" className="ow-link" onClick={cancelSignIn}>
                      Cancel
                    </button>
                  </>
                )}
                {signInError && <span className="ow-error-text"> {signInError}</span>}
              </p>
            )}

            {phase === 'gate' && (
              <section className="ow-panel" aria-live="polite">
                <div>
                  <p className="ow-strong">Your 3 rewrites are ready</p>
                  {hostSignin ? (
                    <p className="ow-small ow-muted">
                      You&apos;ve used your {FREE_TRIES} free tries. Sign in to see these and keep going.
                    </p>
                  ) : reconnect ? (
                    <p className="ow-small ow-muted">
                      This widget was disconnected from your Ordana account, so you&apos;re signed out here. Continue
                      with Ordana to see these and keep going.
                    </p>
                  ) : (
                    <p className="ow-small ow-muted">
                      You&apos;ve used your {FREE_TRIES} free tries. Continue with Ordana to see these and get{' '}
                      {FREE_WITH_ACCOUNT} more free rewrites. One account works in every Ordana widget.
                    </p>
                  )}
                </div>
                <ul className="ow-results" aria-hidden="true">
                  {['Benefit-first', 'Question', 'Short & punchy'].map((label) => (
                    <li key={label} className="ow-result ow-result-locked">
                      <div className="ow-grow">
                        <div className="ow-result-label">{label}</div>
                        <div className="ow-skel ow-skel-static" style={{ width: '82%' }} />
                      </div>
                    </li>
                  ))}
                </ul>
                {continueButton('Continue with Ordana', () => runUse(true))}
                {signInError && <p className="ow-small ow-error-text">{signInError}</p>}
              </section>
            )}

            {phase === 'checking' && (
              <ul className="ow-results" aria-busy="true" aria-label="Rewriting">
                {[78, 64, 52].map((w) => (
                  <li key={w} className="ow-result">
                    <div className="ow-grow">
                      <div className="ow-skel" style={{ width: 72 }} />
                      <div className="ow-skel ow-skel-lg" style={{ width: `${w}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {phase === 'results' && (
              <>
                <ul className="ow-results" aria-live="polite">
                  {results.map((r) => (
                    <ResultRow
                      key={r.id}
                      rewrite={r}
                      hostName={hostName}
                      onUse={shareOn ? () => bridge.send({ chosen_headline: r.text, chosen_style: r.id }) : undefined}
                    />
                  ))}
                </ul>
                {bridge.canSend && consent === null && (
                  <section className="ow-panel ow-panel-tight ow-consent" aria-live="polite">
                    <p className="ow-small">
                      <span className="ow-strong">Keep {hostName} updated with your results?</span>{' '}
                      <span className="ow-muted">It gets the headline you pick and its style, nothing else.</span>
                    </p>
                    <div className="ow-inline">
                      <button type="button" className="ow-btn ow-btn-sm ow-btn-primary" onClick={() => saveConsent('yes')}>
                        Yes
                      </button>
                      <button type="button" className="ow-btn ow-btn-sm" onClick={() => saveConsent('no')}>
                        Not now
                      </button>
                    </div>
                  </section>
                )}
                <UsesHint
                  remaining={remaining}
                  signedIn={user !== null}
                  checkoutUrl={checkoutUrl}
                  onUpgrade={upgrade}
                />
              </>
            )}

            {phase === 'paywall' && (
              <section className="ow-panel" aria-live="polite">
                <div>
                  <p className="ow-strong">You&apos;ve used your free rewrites</p>
                  <p className="ow-small ow-muted">
                    {user
                      ? 'Upgrade for unlimited rewrites. Checkout opens in a new tab, and you’ll see the price before you pay. Your headline stays right here.'
                      : `${hostSignin ? 'Sign in' : 'Continue with Ordana'} to upgrade for unlimited rewrites. You’ll see the price before you pay, and your headline stays right here.`}
                  </p>
                </div>
                {user ? (
                  <button type="button" className="ow-btn ow-btn-primary" onClick={upgrade} disabled={!checkoutUrl}>
                    Upgrade for unlimited
                  </button>
                ) : (
                  continueButton('Continue with Ordana to buy', () => runUse(true))
                )}
                {user && awaitingPayment && (
                  <button type="button" className="ow-btn" onClick={() => void runUse()}>
                    I&apos;ve paid, continue
                  </button>
                )}
                {signInError && <p className="ow-small ow-error-text">{signInError}</p>}
              </section>
            )}

            {phase === 'blocked' && (
              <section className="ow-panel" role="status">
                <p className="ow-strong">Not available right now</p>
                <p className="ow-small ow-muted">Rewrites are paused here for the moment. Please try again later.</p>
              </section>
            )}

            {phase === 'error' && (
              <section className="ow-panel ow-panel-error" role="alert">
                <p className="ow-strong">Couldn&apos;t rewrite that</p>
                <p className="ow-small ow-muted">{error}</p>
                <button type="button" className="ow-btn" onClick={() => void runUse()}>
                  Try again
                </button>
              </section>
            )}
          </div>
        )
      ) : panel === 'menu' ? (
        <Menu
          user={user}
          hostName={hostName}
          signInButton={continueButton('Continue with Ordana')}
          signInError={signInError}
          onPick={setPanel}
          onSignOut={signOut}
        />
      ) : (
        <div className="ow-stack">
          <button type="button" className="ow-link ow-small ow-start" onClick={() => setPanel('menu')}>
            ← Back
          </button>
          {panel === 'billing' && (
            <BillingPanel
              backend={backend}
              signedIn={Boolean(user)}
              signInButton={continueButton('Continue with Ordana')}
              onSignedOut={signedOut}
              onUpgrade={(url) => {
                backend.openCheckout(url)
                setAwaitingPayment(true)
              }}
            />
          )}
          {panel === 'settings' && (
            <SettingsPanel
              onAudience={setAudience}
              hostName={bridge.canSend ? hostName : null}
              consent={consent}
              onConsent={saveConsent}
            />
          )}
          {panel === 'help' && <HelpPanel hostName={hostName} />}
        </div>
      )}
    </WidgetFrame>
  )
}

function ResultRow({ rewrite, hostName, onUse }: { rewrite: Rewrite; hostName: string; onUse?: () => void }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1500)
    return () => clearTimeout(t)
  }, [done])
  return (
    <li className="ow-result">
      <div className="ow-grow">
        <div className="ow-result-label">{rewrite.label}</div>
        <p className="ow-result-text">{rewrite.text}</p>
      </div>
      <button
        type="button"
        className="ow-btn ow-btn-sm"
        aria-label={onUse ? `Use the ${rewrite.label} rewrite in ${hostName}` : `Copy ${rewrite.label} rewrite`}
        onClick={async () => {
          const copied = await copyText(rewrite.text)
          onUse?.()
          setDone(copied || Boolean(onUse))
        }}
      >
        {onUse ? (done ? 'Sent' : 'Use this') : done ? 'Copied' : 'Copy'}
      </button>
    </li>
  )
}

function UsesHint({
  remaining,
  signedIn,
  checkoutUrl,
  onUpgrade,
}: {
  remaining: number | null
  signedIn: boolean
  checkoutUrl: string | null
  onUpgrade: () => void
}) {
  if (remaining === null) return null
  // Signed out it's the 3 tries the server counts, never a bigger number from Ordana.
  const left = signedIn ? remaining : Math.min(remaining, FREE_TRIES)
  const low = left <= 3
  return (
    <p className={`ow-small ${low ? 'ow-hint-low' : 'ow-muted'}`}>
      {left === 0
        ? signedIn
          ? 'That was your last free rewrite.'
          : `That was your last free try. Continue with Ordana for ${FREE_WITH_ACCOUNT} more.`
        : signedIn
          ? `${left} ${left === 1 ? 'free rewrite' : 'free rewrites'} left.`
          : `${left} of ${FREE_TRIES} free tries left.`}
      {low && signedIn && checkoutUrl && (
        <>
          {' '}
          <button type="button" className="ow-link" onClick={onUpgrade}>
            Upgrade for unlimited
          </button>
        </>
      )}
    </p>
  )
}

function Menu({
  user,
  signInButton,
  signInError,
  onPick,
  onSignOut,
  hostName,
}: {
  user: WidgetUser | null
  hostName: string
  signInButton: ReactNode
  signInError: string | null
  onPick: (p: Panel) => void
  onSignOut: () => void
}) {
  const items: { id: Exclude<Panel, null | 'menu'>; label: string }[] = [
    { id: 'settings', label: 'Settings' },
    { id: 'billing', label: 'Plan & billing' },
    { id: 'help', label: 'Help' },
  ]
  return (
    <nav aria-label="Widget menu" className="ow-stack">
      <div className="ow-menu-who">
        {user ? (
          <>
            <p className="ow-strong">{user.name ?? 'Signed in'}</p>
            {isHostUser(user) ? (
              <p className="ow-small ow-muted">Signed in through {hostName}</p>
            ) : (
              <a className="ow-small ow-muted ow-plain-link" href={ORDANA_ACCOUNT} target="_blank" rel="noopener">
                Signed in with Ordana ↗
              </a>
            )}
          </>
        ) : (
          <>
            {signInButton}
            {signInError && <p className="ow-small ow-error-text">{signInError}</p>}
          </>
        )}
      </div>
      <ul className="ow-menu">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className="ow-menu-item" onClick={() => onPick(it.id)}>
              <span>{it.label}</span>
              <span className="ow-small ow-muted" aria-hidden="true">
                ›
              </span>
            </button>
          </li>
        ))}
        {user && (
          <li className="ow-menu-sep">
            <button type="button" className="ow-menu-item" onClick={onSignOut}>
              <span>Sign out</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  )
}

function BillingPanel({
  backend,
  signedIn,
  signInButton,
  onUpgrade,
  onSignedOut,
}: {
  backend: WidgetBackend
  signedIn: boolean
  signInButton: ReactNode
  onUpgrade: (url: string) => void
  onSignedOut: (e: SignedOutError) => void
}) {
  const [state, setState] = useState<CheckResult | 'loading' | 'error'>('loading')
  const signedOutRef = useRef(onSignedOut)
  signedOutRef.current = onSignedOut
  useEffect(() => {
    if (!signedIn) return
    let live = true
    setState('loading')
    backend
      .status()
      .then((r) => live && setState(r))
      .catch((e) => {
        if (!live) return
        // Session gone (e.g. disconnected in Ordana): the parent flips to signed out and this shows "Continue with Ordana".
        if (e instanceof SignedOutError) signedOutRef.current(e)
        else setState('error')
      })
    return () => {
      live = false
    }
  }, [backend, signedIn])

  if (!signedIn) {
    return (
      <section className="ow-stack">
        <p className="ow-strong">Plan &amp; billing</p>
        <p className="ow-small ow-muted">
          You get {FREE_TRIES} free tries without an account. Continue with Ordana for {FREE_WITH_ACCOUNT} more, and to
          see your plan.
        </p>
        <div className="ow-start">{signInButton}</div>
      </section>
    )
  }
  if (state === 'loading') {
    return (
      <section className="ow-stack" aria-busy="true">
        <p className="ow-strong">Plan &amp; billing</p>
        <div className="ow-panel ow-panel-tight">
          <div className="ow-skel" style={{ width: '40%' }} />
          <div className="ow-skel" style={{ width: '70%' }} />
        </div>
      </section>
    )
  }
  if (state === 'error') {
    return (
      <section className="ow-stack" role="alert">
        <p className="ow-strong">Plan &amp; billing</p>
        <p className="ow-small ow-muted">Couldn&apos;t load your plan. Please try again in a moment.</p>
      </section>
    )
  }
  const url = state.checkoutUrl ?? state.creditPackUrl
  const paid = Boolean(state.manageUrl) || (state.entitled && state.plan !== null && state.plan !== 'free')
  return (
    <section className="ow-stack">
      <p className="ow-strong">Plan &amp; billing</p>
      <div className="ow-panel ow-panel-tight">
        <p className="ow-small ow-muted">Plan</p>
        <p className="ow-strong">{paid ? 'Unlimited' : 'Free'}</p>
        {!paid && state.remaining !== null && (
          <p className="ow-small ow-muted">
            {state.remaining} free rewrite{state.remaining === 1 ? '' : 's'} left
          </p>
        )}
      </div>
      {!paid && url && (
        <button type="button" className="ow-btn ow-btn-primary ow-start" onClick={() => onUpgrade(url)}>
          Upgrade for unlimited
        </button>
      )}
      <a className="ow-small ow-plain-link" href={state.manageUrl ?? ORDANA_BILLING} target="_blank" rel="noopener">
        Manage payment in Ordana ↗
      </a>
      <p className="ow-small ow-muted">Card, receipts and cancelling are in your Ordana account.</p>
    </section>
  )
}

function SettingsPanel({
  onAudience,
  hostName,
  consent,
  onConsent,
}: {
  onAudience: (v: string) => void
  /** Set only when a host is connected, so there is something to keep updated. */
  hostName: string | null
  consent: Consent
  onConsent: (v: 'yes' | 'no') => void
}) {
  // The user's own saved default, never a value the host prefilled.
  const [value, setValue] = useState(() => local.get(AUDIENCE_KEY) ?? '')
  const [saved, setSaved] = useState(false)
  return (
    <div className="ow-stack">
      <p className="ow-strong">Settings</p>
      <form
        className="ow-stack"
        onSubmit={(e) => {
          e.preventDefault()
          const v = value.trim()
          if (v) local.set(AUDIENCE_KEY, v)
          else local.remove(AUDIENCE_KEY)
          onAudience(v)
          setSaved(true)
        }}
      >
        <div className="ow-field">
          <label htmlFor="ow-default-audience">Default audience</label>
          <input
            id="ow-default-audience"
            className="ow-input"
            value={value}
            maxLength={80}
            onChange={(e) => {
              setValue(e.target.value)
              setSaved(false)
            }}
            placeholder="e.g. small business owners"
          />
          <p className="ow-small ow-muted ow-mt">Filled in every time. Saved on this device only.</p>
        </div>
        <button className="ow-btn ow-start">{saved ? 'Saved' : 'Save'}</button>
      </form>
      {hostName && (
        <label className="ow-check">
          <input type="checkbox" checked={consent === 'yes'} onChange={(e) => onConsent(e.target.checked ? 'yes' : 'no')} />
          <span>
            <span className="ow-strong">Keep {hostName} updated</span>
            <span className="ow-small ow-muted ow-block">Sends {hostName} the headline you pick and its style.</span>
          </span>
        </label>
      )}
    </div>
  )
}

function HelpPanel({ hostName }: { hostName: string }) {
  const faq: [string, string][] = [
    ['How does it work?', 'Type a headline and, if you like, who it’s for. You get three rewrites to copy straight into your draft.'],
    [
      'Is it free?',
      `You get ${FREE_TRIES} free tries without an account, then ${FREE_WITH_ACCOUNT} more free rewrites when you continue with Ordana. After that you can upgrade for unlimited rewrites.`,
    ],
    ['Is my headline stored?', 'No. Your rewrites are made instantly in your browser and aren’t saved.'],
    [
      `What does ${hostName} see?`,
      `Only the headline you pick and its style, and only if you said yes to “Keep ${hostName} updated”. You can change that in Settings.`,
    ],
    ['Billing questions?', 'Your plan, card and receipts are in your Ordana account: Plan & billing → Manage payment in Ordana.'],
  ]
  return (
    <section className="ow-stack">
      <p className="ow-strong">Help</p>
      <dl className="ow-faq">
        {faq.map(([q, a]) => (
          <div key={q}>
            <dt className="ow-strong">{q}</dt>
            <dd className="ow-small ow-muted">{a}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
