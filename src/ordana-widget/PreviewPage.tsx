import { useEffect, useMemo, useState } from 'react'
import Widget, { type WidgetInitial } from './Widget'
import { parseLook, useGoogleFont } from './theme'
import type { CheckResult, Mode, Variant, WidgetBackend, WidgetUser } from './types'
import './widget.css'

// Fictional data only: no network, no auth, nothing touches the live product.

const DEMO_USER: WidgetUser = { name: 'Maya Jensen', email: 'maya@example.com' }
const DEMO_CHECKOUT = 'https://checkout.example/demo'
const HOST = 'Pageboard'

const LOOKS = {
  default: { label: 'Default', query: '' },
  dark: { label: 'Dark', query: 'theme=dark' },
  editorial: {
    label: 'Editorial',
    query: 'accent=1f5c4a&bg=fbf8f3&surface=f3eee5&text=2a2420&muted=675b51&border=e0d6c8&radius=0&font=Source+Serif+4',
  },
} as const
type LookId = keyof typeof LOOKS

const VERSIONS: Record<Variant, string> = { a: 'a · Headline + audience', b: 'b · One field' }

type Screen = { label: string; signedIn: boolean; remaining: number; initial: WidgetInitial }
const EXAMPLE = { headline: 'Our new app helps you track expenses', audience: 'freelancer' }
const SCREENS: Record<string, Screen> = {
  start: { label: 'Start', signedIn: false, remaining: 20, initial: {} },
  gate: { label: 'Sign-in step', signedIn: false, remaining: 20, initial: { ...EXAMPLE, phase: 'gate' } },
  loading: { label: 'Loading', signedIn: true, remaining: 15, initial: { ...EXAMPLE, phase: 'checking' } },
  results: { label: 'Results', signedIn: true, remaining: 14, initial: { ...EXAMPLE, phase: 'results', remaining: 14 } },
  low: {
    label: 'Running out',
    signedIn: true,
    remaining: 1,
    initial: { ...EXAMPLE, phase: 'results', remaining: 1, checkoutUrl: DEMO_CHECKOUT },
  },
  paywall: {
    label: 'Upgrade screen',
    signedIn: true,
    remaining: 0,
    initial: { ...EXAMPLE, phase: 'paywall', remaining: 0, checkoutUrl: DEMO_CHECKOUT },
  },
  error: {
    label: 'Error',
    signedIn: true,
    remaining: 9,
    initial: { ...EXAMPLE, phase: 'error', error: 'Couldn’t reach the server. Please try again.' },
  },
  menu: { label: '⋯ Menu', signedIn: true, remaining: 14, initial: { panel: 'menu' } },
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function createDemoBackend(screen: Screen, notify: (text: string) => void): WidgetBackend {
  let user: WidgetUser | null = screen.signedIn ? DEMO_USER : null
  let remaining = screen.remaining
  let paid = false
  const answer = (entitled: boolean): CheckResult => ({
    entitled,
    paywall: !entitled,
    checkoutUrl: paid ? null : DEMO_CHECKOUT,
    creditPackUrl: null,
    manageUrl: paid ? 'https://billing.example/demo' : null,
    reason: entitled ? null : 'free_limit_reached',
    remaining: paid ? null : remaining,
    plan: paid ? 'unlimited' : 'free',
  })
  return {
    currentUser: () => user,
    signIn: async () => {
      await wait(700)
      user = DEMO_USER
      return DEMO_USER
    },
    signOut: () => {
      user = null
    },
    use: async () => {
      await wait(600)
      if (paid) return answer(true)
      if (remaining <= 0) return answer(false)
      remaining -= 1
      return answer(true)
    },
    status: async () => {
      await wait(400)
      return answer(paid || remaining > 0)
    },
    openCheckout: () => {
      paid = true
      notify('In the live widget this opens Ordana’s checkout in a new tab. Here we pretend you paid, so press “I’ve paid, continue”.')
    },
  }
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">{label}</legend>
      <span className="text-xs font-semibold uppercase tracking-wide text-stone-500 w-16">{label}</span>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            value === id ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-800 hover:bg-stone-50'
          }`}
        >
          {text}
        </button>
      ))}
    </fieldset>
  )
}

function DemoWidget({ mode, lookId, variant, screenId, notify }: {
  mode: Mode
  lookId: LookId
  variant: Variant
  screenId: string
  notify: (t: string) => void
}) {
  const screen = SCREENS[screenId]
  const look = useMemo(
    () => parseLook(new URLSearchParams(`${LOOKS[lookId].query}&host=${HOST}`), mode),
    [lookId, mode],
  )
  const backend = useMemo(() => createDemoBackend(screen, notify), [screen, notify])
  return <Widget backend={backend} variant={variant} mode={mode} look={look} initial={screen.initial} />
}

/** /ordana-widget-preview — what the founder and hosts click before deciding. */
export default function PreviewPage() {
  const [lookId, setLookId] = useState<LookId>('default')
  const [variant, setVariant] = useState<Variant>('a')
  const [screenId, setScreenId] = useState('start')
  const [notice, setNotice] = useState<string | null>(null)
  const k = `${lookId}-${variant}-${screenId}`

  useGoogleFont(lookId === 'editorial' ? 'Source Serif 4' : null)
  useEffect(() => {
    document.title = 'Headline rewriter: widget preview'
  }, [])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const props = { lookId, variant, screenId, notify: setNotice }

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-5 space-y-4">
          <div>
            <h1 className="text-xl font-bold">Headline rewriter widget: preview</h1>
            <p className="text-sm text-stone-600">
              Example data only. Switch the look to see how the widget takes on a host product&apos;s style.
            </p>
          </div>
          <div className="space-y-2">
            <Segmented
              label="Look"
              value={lookId}
              options={Object.entries(LOOKS).map(([id, l]) => [id as LookId, l.label])}
              onChange={setLookId}
            />
            <Segmented
              label="Version"
              value={variant}
              options={Object.entries(VERSIONS) as [Variant, string][]}
              onChange={setVariant}
            />
            <Segmented
              label="Screen"
              value={screenId}
              options={Object.entries(SCREENS).map(([id, s]) => [id, s.label])}
              onChange={setScreenId}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-10">
        <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-stone-600">Card · 320px</h2>
            <div className="max-w-[320px]">
              <DemoWidget key={`card-${k}`} mode="card" {...props} />
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-stone-600">Modal · opened from the host&apos;s own button</h2>
            <div className="rounded-xl bg-stone-800/70 p-6 sm:p-10 grid place-items-center">
              <div role="dialog" aria-label="Improve your headline" className="w-full max-w-[460px] overflow-hidden rounded-xl bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2 text-sm text-stone-600 bg-white">
                  <span>{HOST} · Improve your headline</span>
                  <span aria-hidden="true">✕</span>
                </div>
                <DemoWidget key={`modal-${k}`} mode="modal" {...props} />
              </div>
            </div>
          </section>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-stone-600">Full page</h2>
          <DemoWidget key={`page-${k}`} mode="page" {...props} />
        </section>
      </main>

      {notice && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 max-w-md rounded-lg bg-stone-900 px-4 py-3 text-sm text-white shadow-lg mx-4">
          {notice}
        </div>
      )}
    </div>
  )
}
