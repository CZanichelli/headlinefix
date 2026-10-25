import { checkEntitlement, HOST_KEY, json, readJson, readSession } from './_lib.js'

const VISITOR = /^[A-Za-z0-9-]{8,64}$/

/**
 * POST /api/ordana-widget/check { key, consume: 0|1, visitor }
 * Asks Ordana before every use (consume: 1, signed in) and for the A/B version or plan (consume: 0).
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  const key = typeof body?.key === 'string' ? body.key : ''
  const consume = body?.consume === 1 ? 1 : 0
  const visitor = typeof body?.visitor === 'string' && VISITOR.test(body.visitor) ? body.visitor : null
  if (!HOST_KEY.test(key)) return json({ error: 'This widget is missing its key.' }, 400)

  const session = await readSession(request)
  if (session === null) return json({ error: 'signed_out' }, 401)
  if (consume === 1 && !session) return json({ error: 'signed_out' }, 401)

  const user = session ? `ordana:${session.sub}` : visitor ? `visitor:${visitor}` : null
  if (!user) return json({ error: 'Missing visitor.' }, 400)

  try {
    return json(await checkEntitlement(key, user, consume))
  } catch (e) {
    console.error('ordana-widget check', e)
    return json({ error: 'Couldn’t check your free rewrites. Please try again.' }, 502)
  }
}
