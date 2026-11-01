import { checkEntitlement, HOST_KEY, json, readJson, readSession } from './_lib.js'

const VISITOR = /^[A-Za-z0-9-]{8,64}$/

/**
 * POST /api/ordana-widget/check { key, consume: 0|1, visitor }
 * Asks Ordana before every use (consume: 1, signed in or not) and on load for the A/B version (consume: 0).
 * Ordana enforces the free tries, asks for sign-in when they run out, and returns the paywall.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  const key = typeof body?.key === 'string' ? body.key : ''
  const consume = body?.consume === 1 ? 1 : 0
  const visitor = typeof body?.visitor === 'string' && VISITOR.test(body.visitor) ? body.visitor : null
  if (!HOST_KEY.test(key)) return json({ error: 'This widget is missing its key.' }, 400)

  const session = await readSession(request)
  if (session === null) return json({ error: 'signed_out' }, 401)

  // end_user_ref: the Ordana "sub" (oid_…) when signed in, else "anon_" + this visitor's random id. Nothing else.
  const endUserRef = session ? session.sub : visitor ? `anon_${visitor}` : null
  if (!endUserRef) return json({ error: 'Missing visitor.' }, 400)

  try {
    return json(await checkEntitlement(key, endUserRef, consume))
  } catch (e) {
    // Fail closed: no rewrite without an answer from Ordana.
    const detail = e instanceof Error ? e.message : String(e)
    console.error('ordana-widget check', detail)
    return json({ error: 'Couldn’t check your free rewrites. Please try again.', detail }, 502)
  }
}
