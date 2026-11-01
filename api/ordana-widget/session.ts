import {
  callbackUrl,
  discover,
  json,
  oidcConfig,
  parkSignIn,
  readJson,
  signSession,
  STATE,
  takeSignIn,
  verifyIdToken,
} from './_lib.js'

const FAILED = 'Sign-in didn’t finish. Please try again.'

type Outcome = { token: string; user: { id: string; name: string | null; email: string | null } } | { error: string }

async function finishSignIn(request: Request, code: string, verifier: string, nonce: string): Promise<Outcome> {
  const cfg = oidcConfig()
  if (!cfg) return { error: 'not_configured' }
  const d = await discover(cfg.issuer)
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl(request),
    client_id: cfg.clientId,
    code_verifier: verifier,
  })
  if (cfg.clientSecret) form.set('client_secret', cfg.clientSecret)
  const res = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const tokens = (await res.json().catch(() => null)) as { id_token?: string; error?: string } | null
  // invalid_grant: the person withdrew consent in Ordana (or the code is stale), so treat them as signed out.
  if (tokens?.error === 'invalid_grant') return { error: 'signed_out' }
  if (!res.ok || !tokens?.id_token) {
    console.error('ordana-widget session: token endpoint', res.status, tokens?.error)
    return { error: 'failed' }
  }
  const c = await verifyIdToken(tokens.id_token, d, cfg.clientId, nonce)
  if (!c) return { error: 'failed' }

  // The user is found-or-created by their Ordana "sub"; we keep no table of our own.
  const user = {
    id: c.sub as string,
    name: typeof c.name === 'string' ? c.name : null,
    email: typeof c.email === 'string' ? c.email : null,
  }
  const token = await signSession({ sub: user.id, name: user.name, email: user.email })
  return { token, user }
}

/**
 * POST /api/ordana-widget/session { state, code, verifier, nonce } — called by the sign-in popup's callback page.
 * Finishes the sign-in and parks the session under `state` for the embed to collect.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  const state = typeof body?.state === 'string' ? body.state : ''
  const code = typeof body?.code === 'string' ? body.code : ''
  const verifier = typeof body?.verifier === 'string' ? body.verifier : ''
  const nonce = typeof body?.nonce === 'string' ? body.nonce : ''
  if (
    !STATE.test(state) ||
    !code ||
    code.length > 2048 ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(verifier) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)
  ) {
    return json({ error: FAILED }, 400)
  }

  let outcome: Outcome
  try {
    outcome = await finishSignIn(request, code, verifier, nonce)
  } catch (e) {
    console.error('ordana-widget session', e instanceof Error ? e.message : e)
    outcome = { error: 'failed' }
  }
  try {
    await parkSignIn(state, outcome)
  } catch (e) {
    console.error('ordana-widget session: park', e instanceof Error ? e.message : e)
    return json({ error: FAILED }, 502)
  }
  return 'error' in outcome ? json({ error: outcome.error }, outcome.error === 'not_configured' ? 503 : 401) : json({ ok: true })
}

/** GET /api/ordana-widget/session?state=… — the embed polls this until the sign-in for its state is done. */
export async function GET(request: Request): Promise<Response> {
  const state = new URL(request.url, 'http://x').searchParams.get('state') ?? ''
  if (!STATE.test(state)) return json({ error: FAILED }, 400)
  try {
    const parked = await takeSignIn(state)
    if (!parked) return json({ status: 'pending' })
    if ('error' in parked) return json({ status: 'error', error: parked.error })
    return json({ status: 'done', token: parked.token, user: parked.user })
  } catch (e) {
    console.error('ordana-widget session: take', e instanceof Error ? e.message : e)
    return json({ status: 'pending' })
  }
}
