import { useEffect, useMemo, useRef, useState } from 'react'
import Widget, { GoneNotice, WidgetFrame } from './Widget'
import { createLiveBackend, loadCheck, type LoadAnswer } from './liveBackend'
import { parseLook, parseMode, useGoogleFont } from './theme'
import type { HostBridge, HostContext, HostResult } from './types'
import './widget.css'

const HOST_KEY = /^wak_[A-Za-z0-9_-]{4,200}$/

/** Keeps only the declared ui.context.in fields, validated like any user input. Anything else is dropped. */
function cleanContext(fields: unknown): HostContext | null {
  if (!fields || typeof fields !== 'object') return null
  const f = fields as Record<string, unknown>
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined
  const ctx: HostContext = { draft_title: text(f.draft_title, 200), audience: text(f.audience, 80) }
  return ctx.draft_title || ctx.audience ? ctx : null
}

/**
 * Shared context with the host page, in the user's browser only (never through Ordana):
 * we say "ready", the host may answer with its context, and we remember its origin so results
 * (after the user said yes) go back to that origin only.
 */
function useHostBridge(): HostBridge {
  const [context, setContext] = useState<HostContext | null>(null)
  const [hostOrigin, setHostOrigin] = useState<string | null>(null)

  useEffect(() => {
    if (window.parent === window) return
    function onMessage(e: MessageEvent) {
      if (e.source !== window.parent) return
      const d = e.data as { type?: unknown; v?: unknown; fields?: unknown } | null
      if (!d || d.type !== 'ordana-widget:context' || d.v !== 1) return
      // An opaque origin ("null", e.g. a file:// page) can't be targeted, so it can't receive results.
      if (/^https?:\/\//.test(e.origin)) setHostOrigin(e.origin)
      setContext(cleanContext(d.fields))
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: 'ordana-widget:ready', v: 1 }, '*')
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return useMemo(
    () => ({
      context,
      canSend: hostOrigin !== null,
      send(result: HostResult) {
        if (!hostOrigin) return
        const fields: HostResult = { chosen_headline: result.chosen_headline, chosen_style: result.chosen_style }
        window.parent.postMessage({ type: 'ordana-widget:result', v: 1, fields }, hostOrigin)
      },
    }),
    [context, hostOrigin],
  )
}

/** What hosts mount: <embed-url>?key=wak_…&mode=card|page|modal plus the theme parameters. */
export default function EmbedPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const mode = parseMode(params.get('mode'))
  const look = useMemo(() => parseLook(params, mode), [params, mode])
  const key = params.get('key')?.trim() ?? ''
  const validKey = HOST_KEY.test(key)
  const backend = useMemo(() => (validKey ? createLiveBackend(key) : null), [validKey, key])
  const [load, setLoad] = useState<LoadAnswer | null>(null)
  const bridge = useHostBridge()
  const shell = useRef<HTMLDivElement>(null)

  useGoogleFont(look.font)

  useEffect(() => {
    const html = document.documentElement
    html.classList.add('ow-embed-doc')
    if (look.fill) html.classList.add('ow-fill')
    document.title = 'Headline rewriter'
  }, [look.fill])

  useEffect(() => {
    if (validKey) loadCheck(key).then(setLoad)
  }, [validKey, key])

  // Hug the content and tell the host page our height on every change.
  useEffect(() => {
    const el = shell.current
    if (!el || look.fill || window.parent === window) return
    let last = -1
    const ro = new ResizeObserver(() => {
      const height = Math.ceil(el.getBoundingClientRect().height)
      if (height === last) return
      last = height
      window.parent.postMessage({ type: 'ordana-widget:resize', height }, '*')
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [look.fill])

  return (
    <div ref={shell} className="ow-shell" data-framed={look.framed}>
      {!validKey ? (
        <WidgetFrame look={look} mode={mode}>
          <section className="ow-panel" role="alert">
            <p className="ow-strong">This widget isn&apos;t set up yet</p>
            <p className="ow-small ow-muted">
              The embed link is missing its key. Use the full link from Ordana, which ends in ?key=wak_…
            </p>
          </section>
        </WidgetFrame>
      ) : load?.gone ? (
        <WidgetFrame look={look} mode={mode}>
          <GoneNotice />
        </WidgetFrame>
      ) : load && backend ? (
        <Widget backend={backend} variant={load.variant} mode={mode} look={look} bridge={bridge} />
      ) : (
        <WidgetFrame look={look} mode={mode}>
          <div className="ow-stack" aria-busy="true" aria-label="Loading">
            <div className="ow-skel" style={{ width: '60%' }} />
            <div className="ow-skel ow-skel-lg" style={{ width: '100%', height: 40 }} />
            <div className="ow-skel ow-skel-lg" style={{ width: 120, height: 40 }} />
          </div>
        </WidgetFrame>
      )}
    </div>
  )
}
