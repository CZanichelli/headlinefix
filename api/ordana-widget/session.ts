import { callbackUrl, discover, idTokenClaims, json, oidcConfig, readJson, signSession } from './_lib.js'

/** POST /api/ordana-widget/session { code, verifier } → { token, user }. */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  const code = typeof body?.code === 'string' ? body.code : ''
  const verifier = typeof body?.verifier === 'string' ? body.verifier : ''
  if (!code || code.length > 2048 || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) {
    return json({ error: 'Sign-in didn’t finish. Please try again.' }, 400)
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
    const tokens = (await res.json().catch(() => null)) as { id_token?: string } | null
    if (!res.ok || !tokens?.id_token) return json({ error: 'Sign-in didn’t finish. Please try again.' }, 401)

    const c = idTokenClaims(tokens.id_token)
    const aud = c?.aud
    const audOk = aud === cfg.clientId || (Array.isArray(aud) && aud.includes(cfg.clientId))
    const fresh = typeof c?.exp === 'number' && c.exp > Date.now() / 1000
    if (!c || c.iss !== d.issuer || !audOk || !fresh || typeof c.sub !== 'string') {
      return json({ error: 'Sign-in didn’t finish. Please try again.' }, 401)
    }

    // The user is found-or-created by their Ordana subject; we keep no table of our own.
    const user = {
      name: typeof c.name === 'string' ? c.name : null,
      email: typeof c.email === 'string' ? c.email : null,
    }
    const token = await signSession({ sub: c.sub, ...user })
    return json({ token, user })
  } catch (e) {
    console.error('ordana-widget session', e)
    return json({ error: 'Sign-in didn’t finish. Please try again.' }, 502)
  }
}
