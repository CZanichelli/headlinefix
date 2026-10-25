import { callbackUrl, discover, json, oidcConfig, readJson, signSession, verifyIdToken } from './_lib.js'

const FAILED = 'Sign-in didn’t finish. Please try again.'

/** POST /api/ordana-widget/session { code, verifier, nonce } → { token, user }. */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  const code = typeof body?.code === 'string' ? body.code : ''
  const verifier = typeof body?.verifier === 'string' ? body.verifier : ''
  const nonce = typeof body?.nonce === 'string' ? body.nonce : ''
  if (!code || code.length > 2048 || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    return json({ error: FAILED }, 400)
  }
  const cfg = oidcConfig()
  if (!cfg) return json({ error: 'Sign-in isn’t switched on for this widget yet.' }, 503)

  try {
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
    if (tokens?.error === 'invalid_grant') return json({ error: 'signed_out' }, 401)
    if (!res.ok || !tokens?.id_token) {
      console.error('ordana-widget session: token endpoint', res.status, tokens?.error)
      return json({ error: FAILED }, 401)
    }

    const c = await verifyIdToken(tokens.id_token, d, cfg.clientId, nonce)
    if (!c) return json({ error: FAILED }, 401)

    // The user is found-or-created by their Ordana "sub"; we keep no table of our own.
    const user = {
      name: typeof c.name === 'string' ? c.name : null,
      email: typeof c.email === 'string' ? c.email : null,
    }
    const token = await signSession({ sub: c.sub as string, ...user })
    return json({ token, user })
  } catch (e) {
    console.error('ordana-widget session', e instanceof Error ? e.message : e)
    return json({ error: FAILED }, 502)
  }
}
