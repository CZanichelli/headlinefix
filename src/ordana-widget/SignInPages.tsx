import { useEffect, useState, type ReactNode } from 'react'
import { session } from './storage'

// These two pages run in the sign-in popup, first-party on our own origin.

const STATE_KEY = 'ow_oidc_state'
const VERIFIER_KEY = 'ow_oidc_verifier'
const NONCE_KEY = 'ow_oidc_nonce'

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

/** /ordana-widget/signin?host=wak_… — makes the PKCE pair and nonce, then hands over to Ordana via our server. */
export function SignInStart() {
  useEffect(() => {
    const host = new URLSearchParams(window.location.search).get('host') ?? ''
    const state = randomString(16)
    const nonce = randomString(16)
    const verifier = randomString(32)
    session.set(STATE_KEY, state)
    session.set(NONCE_KEY, nonce)
    session.set(VERIFIER_KEY, verifier)
    challengeFor(verifier).then((challenge) => {
      const q = new URLSearchParams({ state, nonce, code_challenge: challenge, host })
      window.location.replace(`/api/ordana-widget/authorize?${q}`)
    })
  }, [])
  return (
    <Shell>
      <p className="font-medium">Opening Ordana sign-in…</p>
    </Shell>
  )
}

/** /ordana-widget/callback — Ordana returns here; pass the code to the widget that opened us. */
export function SignInCallback() {
  const [text, setText] = useState('Finishing sign-in…')
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const opener = window.opener as Window | null
    const verifier = session.get(VERIFIER_KEY)
    const nonce = session.get(NONCE_KEY)
    const stateOk = q.get('state') !== null && q.get('state') === session.get(STATE_KEY)
    session.remove(STATE_KEY)
    session.remove(NONCE_KEY)
    session.remove(VERIFIER_KEY)

    const error = q.get('error') ?? (!stateOk || !q.get('code') ? 'invalid_response' : null)
    if (!opener) {
      setText('Sign-in finished. You can close this window and go back to the widget.')
      return
    }
    opener.postMessage(
      error
        ? { type: 'ordana-widget:signin', error }
        : { type: 'ordana-widget:signin', code: q.get('code'), verifier, nonce },
      window.location.origin,
    )
    if (error === 'not_configured') {
      setText('Sign-in isn’t switched on for this widget yet. You can close this window.')
      return
    }
    window.close()
  }, [])
  return (
    <Shell>
      <p className="font-medium">{text}</p>
    </Shell>
  )
}
