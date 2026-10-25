import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RewriteTool, type GateResult } from '../features/rewrite'
import { useAuth } from '../features/auth/AuthContext'
import {
  FREE_ANON_LIMIT,
  FREE_MONTHLY_LIMIT,
  getAnonUses,
  getMonthlyUses,
  incrementAnonUses,
  recordUse,
} from '../features/usage/usage'

const signupPanel = (
  <div className="notice space-y-3">
    <h2 className="font-semibold text-lg">Create a free account to keep going</h2>
    <p className="muted">
      You&apos;ve used your {FREE_ANON_LIMIT} free rewrites. A free account gives you{' '}
      {FREE_MONTHLY_LIMIT} rewrites every month.
    </p>
    <Link to="/signup" className="btn btn-primary">
      Create free account
    </Link>
  </div>
)

const limitPanel = (
  <div className="notice space-y-3">
    <p>
      You&apos;ve hit the free limit, see <Link to="/pricing" className="link">Pricing</Link>.
    </p>
  </div>
)

export default function AppPage() {
  const { user, loading } = useAuth()
  const userId = user?.id
  const [anonUses, setAnonUses] = useState(getAnonUses)
  const [monthly, setMonthly] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    getMonthlyUses(userId).then(setMonthly).catch(() => setMonthly(null))
  }, [userId])

  const beforeGenerate = useCallback(async (): Promise<GateResult> => {
    if (!userId) {
      return getAnonUses() >= FREE_ANON_LIMIT ? { ok: false, message: null } : { ok: true }
    }
    try {
      const used = await getMonthlyUses(userId)
      setMonthly(used)
      return used >= FREE_MONTHLY_LIMIT ? { ok: false, message: limitPanel } : { ok: true }
    } catch {
      return { ok: false, message: <p className="error">Couldn&apos;t check your usage. Please try again.</p> }
    }
  }, [userId])

  const onGenerated = useCallback(async () => {
    if (!userId) {
      setAnonUses(incrementAnonUses())
      return
    }
    try {
      setSaveError(null)
      await recordUse(userId)
      setMonthly((m) => (m ?? 0) + 1)
    } catch (e) {
      console.error('Failed to record usage', e)
      setSaveError(e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Unknown error')
    }
  }, [userId])

  if (loading) return null

  const hint = userId
    ? monthly !== null && `${Math.max(FREE_MONTHLY_LIMIT - monthly, 0)} of ${FREE_MONTHLY_LIMIT} left this month.`
    : `${Math.max(FREE_ANON_LIMIT - anonUses, 0)} of ${FREE_ANON_LIMIT} free rewrites left.`

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Rewrite your headline</h1>
      <RewriteTool
        beforeGenerate={beforeGenerate}
        onGenerated={onGenerated}
        footer={
          <>
            {hint && <p className="muted text-sm">{hint}</p>}
            {saveError && <p className="error text-sm">Couldn&apos;t save usage: {saveError}</p>}
            {!userId && anonUses >= FREE_ANON_LIMIT && signupPanel}
          </>
        }
      />
    </div>
  )
}
