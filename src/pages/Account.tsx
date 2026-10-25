import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext'
import { FREE_MONTHLY_LIMIT, getMonthlyUses } from '../features/usage/usage'
import { supabase } from '../lib/supabase'

export default function Account() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [used, setUsed] = useState<number | null>(null)
  const userId = user?.id

  useEffect(() => {
    if (!userId) return
    getMonthlyUses(userId).then(setUsed).catch(() => setUsed(null))
  }, [userId])

  if (loading) return null
  if (!user) return <Navigate to="/login" replace />

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">Account</h1>
      <div className="card space-y-2">
        <div>
          <div className="muted text-sm">Email</div>
          <div>{user.email}</div>
        </div>
        <div>
          <div className="muted text-sm">Rewrites used this month</div>
          <div>{used === null ? '…' : `${used} of ${FREE_MONTHLY_LIMIT}`}</div>
        </div>
      </div>
      <button className="btn" onClick={signOut}>
        Sign out
      </button>
    </div>
  )
}
