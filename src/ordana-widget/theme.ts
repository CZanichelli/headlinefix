import { useEffect } from 'react'
import type { Mode } from './types'

/** How the host wants it to look, read from the embed URL. Anything invalid is ignored. */
export type Look = {
  theme: 'light' | 'dark'
  vars: Record<string, string>
  framed: boolean
  fill: boolean
  font: string | null
  host: string | null
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const FONT = /^[A-Za-z0-9][A-Za-z0-9 ]{0,49}$/

const COLOR_PARAMS: Record<string, string> = {
  accent: '--widget-accent',
  accent_text: '--widget-accent-text',
  bg: '--widget-bg',
  surface: '--widget-surface',
  text: '--widget-text',
  muted: '--widget-muted',
  border: '--widget-border',
}

function hex(value: string | null): string | null {
  if (!value || !HEX.test(value.trim())) return null
  const v = value.trim().replace('#', '')
  return '#' + (v.length === 3 ? [...v].map((c) => c + c).join('') : v).toLowerCase()
}

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** White or near-black, whichever reads better on the accent. */
function textOn(accent: string): string {
  const l = luminance(accent)
  // Contrast against white vs against #111111 (luminance ≈ 0.0056).
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0556 ? '#ffffff' : '#111111'
}

export function parseMode(value: string | null): Mode {
  return value === 'page' || value === 'modal' ? value : 'card'
}

export function parseLook(params: URLSearchParams, mode: Mode): Look {
  const vars: Record<string, string> = {}
  for (const [param, cssVar] of Object.entries(COLOR_PARAMS)) {
    const v = hex(params.get(param))
    if (v) vars[cssVar] = v
  }
  if (vars['--widget-accent'] && !vars['--widget-accent-text']) {
    vars['--widget-accent-text'] = textOn(vars['--widget-accent'])
  }

  const radius = params.get('radius')
  if (radius && /^\d{1,2}$/.test(radius) && Number(radius) <= 24) vars['--widget-radius'] = `${Number(radius)}px`

  const fontParam = params.get('font')?.trim() ?? ''
  const font = FONT.test(fontParam) ? fontParam : null
  if (font) vars['--widget-font'] = `'${font}', system-ui, -apple-system, 'Segoe UI', sans-serif`

  const hostParam = params.get('host')?.trim().slice(0, 60) ?? ''

  return {
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    vars,
    // A modal sits inside the host's own dialog, so it brings no frame of its own.
    framed: params.get('frame') !== 'none' && mode !== 'modal',
    fill: params.get('fit') === 'fill',
    font,
    host: hostParam || null,
  }
}

/** Loads a Google Fonts family on demand (falls back to regular weight if the family has no 500/600). */
export function useGoogleFont(family: string | null) {
  useEffect(() => {
    if (!family) return
    const id = `ow-font-${family.replace(/\s+/g, '-')}`
    if (document.getElementById(id)) return
    const name = encodeURIComponent(family).replace(/%20/g, '+')
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${name}:wght@400;500;600&display=swap`
    link.onerror = () => {
      link.onerror = null
      link.href = `https://fonts.googleapis.com/css2?family=${name}&display=swap`
    }
    document.head.appendChild(link)
  }, [family])
}
