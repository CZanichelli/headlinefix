import { HOST_KEY, hostSignIn, json, ordanaConnected, readJson, signSession } from './_lib.js'

/**
 * POST /api/ordana-widget/host-signin { key, token } — a host signs its own user in to the widget.
 * The embed passes on the token the host page posted; Ordana says who it is (hid_…), and we sign a widget
 * session for that sub exactly like "Continue with Ordana" does for oid_…. No user table: identity is the sub.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  const key = typeof body?.key === 'string' ? body.key : ''
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!HOST_KEY.test(key)) return json({ error: 'This widget is missing its key.' }, 400)
  if (!token || token.length > 4096) return json({ error: 'invalid_token' }, 400)
  if (!ordanaConnected()) return json({ error: 'not_configured' }, 503)

  try {
    const who = await hostSignIn(key, token)
    if (!who) return json({ error: 'refused' }, 401)
    const session = await signSession({ sub: who.sub, name: who.name, email: who.email })
    return json({ token: session, user: { id: who.sub, name: who.name, email: who.email } })
  } catch (e) {
    console.error('ordana-widget host-signin', e instanceof Error ? e.message : e)
    return json({ error: 'failed' }, 502)
  }
}
