import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/**
 * /ordana-widget/open#token_hash=… — where "Open HeadlineFix" in the widget lands. The one-time link from
 * api/ordana-widget/open-link.ts signs the widget user straight in to the app, then we go to /app.
 */
export default function OpenPage() {
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1)).get('token_hash')
    // Drop the token from the address bar and history straight away.
    window.history.replaceState(null, '', window.location.pathname)
    if (!hash) {
      setFailed(true)
      return
    }
    supabase.auth.verifyOtp({ token_hash: hash, type: 'email' }).then(({ error }) => {
      if (error) setFailed(true)
      else navigate('/app', { replace: true })
    })
  }, [navigate])

  return (
    <main className="mx-auto max-w-md p-8 text-center">
      {failed ? (
        <>
          <p className="font-semibold">That link has expired or was already used.</p>
          <p className="muted mt-2">
            Open it again from the widget, or <a href="/login">log in</a>.
          </p>
        </>
      ) : (
        <p className="muted">Signing you in…</p>
      )}
    </main>
  )
}
