import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { rewriteHeadline, type Rewrite } from '../features/rewrite'
import { local } from './storage'
import type { Look } from './theme'
import { SignedOutError, type CheckResult, type Mode, type Variant, type WidgetBackend, type WidgetUser } from './types'

export type Phase = 'idle' | 'gate' | 'checking' | 'results' | 'paywall' | 'blocked' | 'error'
export type Panel = null | 'menu' | 'account' | 'billing' | 'settings' | 'help'

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

const COPY: Record<Variant, { description: string; button: string }> = {
  a: { description: 'Get three sharper versions of any headline.', button: 'Rewrite it' },
  b: { description: 'Paste a headline. Get three better ones.', button: 'Fix my headline' },
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.')

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

/** The shared outer frame: top bar + body. Also used for the "no key" message. */
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

type Props = {
  backend: WidgetBackend
  variant: Variant
  mode: Mode
  look: Look
  initial?: WidgetInitial
}

export default function Widget({ backend, variant, mode, look, initial = {} }: Props) {
  const [user, setUser] = useState<WidgetUser | null>(() => backend.currentUser())
  const [headline, setHeadline] = useState(initial.headline ?? '')
  const [audience, setAudience] = useState(() => initial.audience ?? local.get(AUDIENCE_KEY) ?? '')
  const [showAudience, setShowAudience] = useState(variant === 'a' || Boolean(initial.audience))
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
  const copy = COPY[variant]

  function applyCheck(r: CheckResult) {
    setRemaining(r.remaining)
    setCheckoutUrl(r.checkoutUrl ?? r.creditPackUrl)
  }

  async function runUse() {
    setPhase('checking')
    setError(null)
    try {
      const r = await backend.use()
      applyCheck(r)
      if (r.entitled) {
        setResults(rewriteHeadline(headline, audience))
        setAwaitingPayment(false)
        setPhase('results')
      } else if (r.paywall && (r.checkoutUrl || r.creditPackUrl)) {
        setPhase('paywall')
      } else {
        setPhase('blocked')
      }
    } catch (e) {
      if (e instanceof SignedOutError) {
        setUser(null)
        setPhase('gate')
        return
      }
      setError(message(e))
      setPhase('error')
    }
  }

  function signIn(then?: () => void | Promise<void>) {
    setSignInError(null)
    setSigningIn(true)
    // backend.signIn() opens its popup before any await, so it stays inside the click.
    backend
      .signIn()
      .then(async (u) => {
        setUser(u)
        await then?.()
      })
      .catch((e) => setSignInError(message(e)))
      .finally(() => setSigningIn(false))
  }

  function signOut() {
    backend.signOut()
    setUser(null)
    setRemaining(null)
    setResults([])
    setPhase('idle')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!headline.trim() || phase === 'checking') return
    if (!user) {
      setPhase('gate')
      return
    }
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

  const continueButton = (label: string, then?: () => void | Promise<void>) => (
    <button type="button" className="ow-btn ow-btn-primary" disabled={signingIn} onClick={() => signIn(then)}>
      {signingIn ? 'Waiting for sign-in…' : label}
    </button>
  )

  return (
    <WidgetFrame look={look} mode={mode} menuButton={menuButton}>
      {panel === null ? (
        <div className="ow-stack">
          <p className="ow-muted">{copy.description}</p>

          <form onSubmit={onSubmit} className="ow-form" data-variant={variant}>
            <div className="ow-fields">
              <div className="ow-field ow-field-headline">
                <label htmlFor="ow-headline">Your headline</label>
                <div className="ow-row">
                  <input
                    id="ow-headline"
                    className="ow-input"
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    placeholder="e.g. Our new app helps you track expenses"
                    autoComplete="off"
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
                  <label htmlFor="ow-audience">
                    Who is it for? <span className="ow-muted ow-normal">(optional)</span>
                  </label>
                  <input
                    id="ow-audience"
                    className="ow-input"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="e.g. freelancer"
                    autoComplete="off"
                  />
                </div>
              ) : (
                <button type="button" className="ow-link ow-small ow-start" onClick={() => setShowAudience(true)}>
                  + Add audience
                </button>
              )}
            </div>
            {variant === 'a' && (
              <button className="ow-btn ow-btn-primary ow-submit" disabled={phase === 'checking'}>
                {copy.button}
              </button>
            )}
          </form>

          {phase === 'idle' && !user && (
            <p className="ow-small ow-muted">
              Already have an account?{' '}
              <button type="button" className="ow-link" onClick={() => signIn()} disabled={signingIn}>
                Sign in
              </button>
              {signInError && <span className="ow-error-text"> {signInError}</span>}
            </p>
          )}

          {phase === 'gate' && (
            <section className="ow-panel" aria-live="polite">
              <div>
                <p className="ow-strong">Your 3 rewrites are ready</p>
                <p className="ow-small ow-muted">
                  Continue with Ordana to see them. It&apos;s free for 20 rewrites a month, and one account works in every
                  Ordana widget.
                </p>
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
              {continueButton('Continue with Ordana', runUse)}
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
                  <ResultRow key={r.id} rewrite={r} />
                ))}
              </ul>
              <UsesHint remaining={remaining} checkoutUrl={checkoutUrl} onUpgrade={upgrade} />
            </>
          )}

          {phase === 'paywall' && (
            <section className="ow-panel" aria-live="polite">
              <div>
                <p className="ow-strong">You&apos;ve used this month&apos;s free rewrites</p>
                <p className="ow-small ow-muted">
                  Upgrade for unlimited rewrites. Checkout opens in a new tab, and you&apos;ll see the price before you
                  pay. Your headline stays right here.
                </p>
              </div>
              <button type="button" className="ow-btn ow-btn-primary" onClick={upgrade}>
                Upgrade for unlimited
              </button>
              {awaitingPayment && (
                <button type="button" className="ow-btn" onClick={() => void runUse()}>
                  I&apos;ve paid, continue
                </button>
              )}
            </section>
          )}

          {phase === 'blocked' && (
            <section className="ow-panel" role="status">
              <p className="ow-strong">Free rewrites are paused here for now</p>
              <p className="ow-small ow-muted">This site has used its free rewrites for the month. Please try again later.</p>
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
      ) : panel === 'menu' ? (
        <Menu onPick={setPanel} signedIn={Boolean(user)} />
      ) : (
        <div className="ow-stack">
          <button type="button" className="ow-link ow-small ow-start" onClick={() => setPanel('menu')}>
            ← Back
          </button>
          {panel === 'account' &&
            (user ? (
              <AccountPanel user={user} onSignOut={signOut} />
            ) : (
              <section className="ow-stack">
                <p className="ow-strong">Account</p>
                <p className="ow-small ow-muted">
                  Sign in to rewrite headlines. If you&apos;ve used any Ordana widget before, it&apos;s one tap.
                </p>
                {continueButton('Continue with Ordana')}
                {signInError && <p className="ow-small ow-error-text">{signInError}</p>}
              </section>
            ))}
          {panel === 'billing' && (
            <BillingPanel
              backend={backend}
              signedIn={Boolean(user)}
              signInButton={continueButton('Continue with Ordana')}
              onUpgrade={(url) => {
                backend.openCheckout(url)
                setAwaitingPayment(true)
              }}
            />
          )}
          {panel === 'settings' && <SettingsPanel audience={audience} onAudience={setAudience} />}
          {panel === 'help' && <HelpPanel />}
        </div>
      )}
    </WidgetFrame>
  )
}

function ResultRow({ rewrite }: { rewrite: Rewrite }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <li className="ow-result">
      <div className="ow-grow">
        <div className="ow-result-label">{rewrite.label}</div>
        <p className="ow-result-text">{rewrite.text}</p>
      </div>
      <button
        type="button"
        className="ow-btn ow-btn-sm"
        aria-label={`Copy ${rewrite.label} rewrite`}
        onClick={async () => setCopied(await copyText(rewrite.text))}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </li>
  )
}

function UsesHint({
  remaining,
  checkoutUrl,
  onUpgrade,
}: {
  remaining: number | null
  checkoutUrl: string | null
  onUpgrade: () => void
}) {
  if (remaining === null) return null
  const low = remaining <= 3
  return (
    <p className={`ow-small ${low ? 'ow-hint-low' : 'ow-muted'}`}>
      {remaining === 0
        ? 'That was your last free rewrite this month.'
        : `${remaining} free rewrite${remaining === 1 ? '' : 's'} left this month.`}
      {low && checkoutUrl && (
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

function Menu({ onPick, signedIn }: { onPick: (p: Panel) => void; signedIn: boolean }) {
  const items: { id: Exclude<Panel, null | 'menu'>; label: string; hint?: string }[] = [
    { id: 'account', label: 'Account', hint: signedIn ? undefined : 'Sign in' },
    { id: 'billing', label: 'Billing' },
    { id: 'settings', label: 'Settings' },
    { id: 'help', label: 'Help' },
  ]
  return (
    <nav aria-label="Widget menu">
      <ul className="ow-menu">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className="ow-menu-item" onClick={() => onPick(it.id)}>
              <span>{it.label}</span>
              <span className="ow-small ow-muted">{it.hint ?? '›'}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="ow-made">
        Made on{' '}
        <a href="https://joinordana.com" target="_blank" rel="noopener">
          Ordana
        </a>
      </p>
    </nav>
  )
}

function AccountPanel({ user, onSignOut }: { user: WidgetUser; onSignOut: () => void }) {
  return (
    <section className="ow-stack">
      <p className="ow-strong">Account</p>
      <div className="ow-panel ow-panel-tight">
        <p className="ow-strong">{user.name ?? 'Signed in'}</p>
        {user.email && <p className="ow-small ow-muted">{user.email}</p>}
        <p className="ow-small ow-muted">Signed in with your Ordana account.</p>
      </div>
      <button type="button" className="ow-btn ow-start" onClick={onSignOut}>
        Sign out
      </button>
    </section>
  )
}

function BillingPanel({
  backend,
  signedIn,
  signInButton,
  onUpgrade,
}: {
  backend: WidgetBackend
  signedIn: boolean
  signInButton: ReactNode
  onUpgrade: (url: string) => void
}) {
  const [state, setState] = useState<CheckResult | 'loading' | 'error'>('loading')
  useEffect(() => {
    if (!signedIn) return
    let live = true
    setState('loading')
    backend
      .status()
      .then((r) => live && setState(r))
      .catch(() => live && setState('error'))
    return () => {
      live = false
    }
  }, [backend, signedIn])

  if (!signedIn) {
    return (
      <section className="ow-stack">
        <p className="ow-strong">Billing</p>
        <p className="ow-small ow-muted">Sign in to see your plan and free rewrites.</p>
        {signInButton}
      </section>
    )
  }
  if (state === 'loading') {
    return (
      <section className="ow-stack" aria-busy="true">
        <p className="ow-strong">Billing</p>
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
        <p className="ow-strong">Billing</p>
        <p className="ow-small ow-muted">Couldn&apos;t load your plan. Please try again in a moment.</p>
      </section>
    )
  }
  const url = state.checkoutUrl ?? state.creditPackUrl
  const paid = state.entitled && state.remaining === null && state.plan !== null && state.plan !== 'free'
  return (
    <section className="ow-stack">
      <p className="ow-strong">Billing</p>
      <div className="ow-panel ow-panel-tight">
        <p className="ow-small ow-muted">Plan</p>
        <p className="ow-strong">{paid ? 'Unlimited' : 'Free'}</p>
        {state.remaining !== null && (
          <p className="ow-small ow-muted">
            {state.remaining} free rewrite{state.remaining === 1 ? '' : 's'} left this month
          </p>
        )}
      </div>
      {!paid && url && (
        <button type="button" className="ow-btn ow-btn-primary" onClick={() => onUpgrade(url)}>
          Upgrade for unlimited
        </button>
      )}
      <p className="ow-small ow-muted">Payments and receipts are handled by Ordana.</p>
    </section>
  )
}

function SettingsPanel({ audience, onAudience }: { audience: string; onAudience: (v: string) => void }) {
  const [value, setValue] = useState(audience)
  const [saved, setSaved] = useState(false)
  return (
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
      <p className="ow-strong">Settings</p>
      <div className="ow-field">
        <label htmlFor="ow-default-audience">Default audience</label>
        <input
          id="ow-default-audience"
          className="ow-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setSaved(false)
          }}
          placeholder="e.g. small business owners"
        />
        <p className="ow-small ow-muted ow-mt">Pre-filled every time. Saved on this device only.</p>
      </div>
      <button className="ow-btn ow-start">{saved ? 'Saved' : 'Save'}</button>
    </form>
  )
}

function HelpPanel() {
  const faq: [string, string][] = [
    ['How does it work?', 'Type a headline and, if you like, who it’s for. You get three rewrites to copy straight into your draft.'],
    ['Is it free?', 'You get 20 free rewrites every month. After that you can upgrade for unlimited rewrites.'],
    ['Is my headline stored?', 'No. Your rewrites are made instantly in your browser and aren’t saved.'],
    ['Billing questions?', 'Your plan and receipts are in your Ordana account, which you used to sign in.'],
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
