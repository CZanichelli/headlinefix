import { callbackUrl, discover, oidcConfig, sessionConfigured } from './_lib.js'

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/

/** GET /api/ordana-widget/authorize?state=…&code_challenge=… → redirect to Ordana's sign-in. */
export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url, 'http://x').searchParams
  const state = q.get('state') ?? ''
  const challenge = q.get('code_challenge') ?? ''
  const back = callbackUrl(request)
  const fail = (error: string) => Response.redirect(`${back}?error=${error}&state=${encodeURIComponent(state)}`, 302)

  if (!TOKEN.test(state) || !TOKEN.test(challenge)) return fail('invalid_request')
  const cfg = oidcConfig()
  if (!cfg || !sessionConfigured()) return fail('not_configured')

  try {
    const d = await discover(cfg.issuer)
    const target = new URL(d.authorization_endpoint)
    target.search = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: back,
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()
    return Response.redirect(target.toString(), 302)
  } catch {
    return fail('server_error')
  }
}
