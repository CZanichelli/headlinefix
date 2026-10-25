import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

// "casper.z@mail.com" -> "Casper"
function firstName(email?: string): string {
  const part = (email ?? '').split('@')[0].split(/[._+-]/)[0]
  return part ? part[0].toUpperCase() + part.slice(1) : 'you'
}

export default function Layout() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/')
  }
  return (
    <div className="min-h-screen">
      <header style={{ borderBottom: '1px solid var(--color-border)' }}>
        <nav className="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
          <Link to="/" className="font-bold text-lg">
            HeadlineFix
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <NavLink to="/app">Tool</NavLink>
            <NavLink to="/pricing">Pricing</NavLink>
            {!loading &&
              (user ? (
                <>
                  <NavLink to="/account">Account</NavLink>
                  <span className="muted hidden sm:inline">Signed in as {firstName(user.email)}</span>
                  <button className="btn" onClick={signOut}>
                    Sign out
                  </button>
                </>
              ) : (
                <NavLink to="/login">Log in</NavLink>
              ))}
          </div>
        </nav>
      </header>
      {!isSupabaseConfigured && (
        <div className="notice mx-auto max-w-3xl my-4 text-sm">
          Supabase isn&apos;t configured. Create <code>.env.local</code> from <code>.env.example</code>{' '}
          and restart the dev server. The logged-out tool still works.
        </div>
      )}
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Outlet />
      </main>
    </div>
  )
}
