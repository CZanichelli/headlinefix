import { useEffect, useState, type ReactNode } from 'react'
import { session } from './storage'

// These two pages run in the sign-in popup, first-party on our own origin.

const STATE_KEY = 'ow_oidc_state'
const VERIFIER_KEY = 'ow_oidc_verifier'
const NONCE_KEY = 'ow_oidc_nonce'
const STATE = /^[A-Za-z0-9_-]{16,128}$/

function randomString(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center p-6 text-center">
      <div className="space-y-2 max-w-xs">{children}</div>
    </main>
  )
}

/**
 * /ordana-widget/signin?host=wak_…&state=… — the embed picks the state (it polls our server with it);
 * this page makes the PKCE pair and nonce, then hands over to Ordana via our server.
 */
export function SignInStart() {
  const [text, setText] = useState('Opening Ordana sign-in…')
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const host = q.get('host') ?? ''
    const state = q.get('state') ?? ''
    if (!STATE.test(state)) {
      setText('This sign-in link is incomplete. Close this window and try again from the widget.')
      return
    }
    const nonce = randomString(16)
    const verifier = randomString(32)
    session.set(STATE_KEY, state)
    session.set(NONCE_KEY, nonce)
    session.set(VERIFIER_KEY, verifier)
    challengeFor(verifier).then((challenge) => {
      const p = new URLSearchParams({ state, nonce, code_challenge: challenge, host })
      window.location.replace(`/api/ordana-widget/authorize?${p}`)
    })
  }, [])
  return (
    <Shell>
      <p className="font-medium">{text}</p>
    </Shell>
  )
}

/**
 * /ordana-widget/callback — Ordana returns here. Our server finishes the sign-in and keeps it for the
 * embed (which polls); a message to the embed, when it still has a link to us, only makes that faster.
 */
export function SignInCallback() {
  const [text, setText] = useState('Finishing sign-in…')
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const state = q.get('state') ?? ''
    const verifier = session.get(VERIFIER_KEY)
    const nonce = session.get(NONCE_KEY)
    const stateOk = STATE.test(state) && state === session.get(STATE_KEY)
    session.remove(STATE_KEY)
    session.remove(NONCE_KEY)
    session.remove(VERIFIER_KEY)

    const tell = (msg: Record<string, unknown>) => {
      try {
        ;(window.opener as Window | null)?.postMessage({ type: 'ordana-widget:signin', state, ...msg }, window.location.origin)
      } catch {
        /* lost the link to the embed; it polls the server instead */
      }
    }

    const error = q.get('error') ?? (!stateOk || !q.get('code') || !verifier || !nonce ? 'invalid_response' : null)
    if (error) {
      tell({ error })
      setText(
        error === 'not_configured'
          ? 'Sign-in isn’t switched on for this widget yet. You can close this window.'
          : 'Sign-in didn’t finish. Close this window and try again from the widget.',
      )
      return
    }

    fetch('/api/ordana-widget/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, code: q.get('code'), verifier, nonce }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error ?? 'failed')
        tell({ ok: true })
        setText('You’re signed in. You can close this window.')
        setTimeout(() => window.close(), 600)
      })
      .catch((e: unknown) => {
        const code = e instanceof Error ? e.message : 'failed'
        tell({ error: code })
        setText('Sign-in didn’t finish. Close this window and try again from the widget.')
      })
  }, [])
  return (
    <Shell>
      <p className="font-medium">{text}</p>
    </Shell>
  )
}
