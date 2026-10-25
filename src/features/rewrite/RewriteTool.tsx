import { useState, type FormEvent, type ReactNode } from 'react'
import { rewriteHeadline, type Rewrite } from './rewrite'

export type GateResult = { ok: true } | { ok: false; message: ReactNode }

type Props = {
  /** Called before each generation. Return { ok: false } to block it (limits, auth, etc.). */
  beforeGenerate?: () => Promise<GateResult>
  /** Called after a successful generation. */
  onGenerated?: () => void | Promise<void>
  /** Optional content shown under the form (e.g. a remaining-uses hint). */
  footer?: ReactNode
}

export default function RewriteTool({ beforeGenerate, onGenerated, footer }: Props) {
  const [headline, setHeadline] = useState('')
  const [audience, setAudience] = useState('')
  const [results, setResults] = useState<Rewrite[]>([])
  const [blocked, setBlocked] = useState<ReactNode>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!headline.trim() || busy) return
    setBusy(true)
    setBlocked(null)
    try {
      const gate = beforeGenerate ? await beforeGenerate() : { ok: true as const }
      if (!gate.ok) {
        setBlocked(gate.message)
        return
      }
      setResults(rewriteHeadline(headline, audience))
      await onGenerated?.()
    } finally {
      setBusy(false)
    }
  }

  async function copy(r: Rewrite) {
    try {
      await navigator.clipboard.writeText(r.text)
      setCopied(r.id)
      setTimeout(() => setCopied((c) => (c === r.id ? null : c)), 1500)
    } catch {
      /* clipboard unavailable; ignore */
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="card space-y-4">
        <div>
          <label htmlFor="headline" className="block text-sm font-medium mb-1">
            Your headline
          </label>
          <textarea
            id="headline"
            className="input"
            rows={2}
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="e.g. Our new app helps you track expenses"
          />
        </div>
        <div>
          <label htmlFor="audience" className="block text-sm font-medium mb-1">
            Who is it for? <span className="muted font-normal">(optional)</span>
          </label>
          <input
            id="audience"
            className="input"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. freelancer"
          />
        </div>
        <button className="btn btn-primary" disabled={busy || !headline.trim()}>
          {busy ? 'Working…' : 'Rewrite it'}
        </button>
      </form>

      {footer}
      {blocked}

      {results.length > 0 && (
        <ul className="space-y-3">
          {results.map((r) => (
            <li key={r.id} className="card flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide muted">{r.label}</div>
                <p className="text-lg font-medium">{r.text}</p>
              </div>
              <button type="button" className="btn shrink-0" onClick={() => copy(r)}>
                {copied === r.id ? 'Copied!' : 'Copy'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
