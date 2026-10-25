import { useEffect, useMemo, useRef, useState } from 'react'
import Widget, { WidgetFrame } from './Widget'
import { createLiveBackend, fetchVariant } from './liveBackend'
import { parseLook, parseMode, useGoogleFont } from './theme'
import type { Variant } from './types'
import './widget.css'

const HOST_KEY = /^wak_[A-Za-z0-9_-]{4,200}$/

/** What hosts mount: <embed-url>?key=wak_…&mode=card|page|modal plus the theme parameters. */
export default function EmbedPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const mode = parseMode(params.get('mode'))
  const look = useMemo(() => parseLook(params, mode), [params, mode])
  const key = params.get('key')?.trim() ?? ''
  const validKey = HOST_KEY.test(key)
  const backend = useMemo(() => (validKey ? createLiveBackend(key) : null), [validKey, key])
  const [variant, setVariant] = useState<Variant | null>(null)
  const shell = useRef<HTMLDivElement>(null)

  useGoogleFont(look.font)

  useEffect(() => {
    const html = document.documentElement
    html.classList.add('ow-embed-doc')
    if (look.fill) html.classList.add('ow-fill')
    document.title = 'Headline rewriter'
  }, [look.fill])

  useEffect(() => {
    if (validKey) fetchVariant(key).then(setVariant)
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
      ) : variant && backend ? (
        <Widget backend={backend} variant={variant} mode={mode} look={look} />
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
