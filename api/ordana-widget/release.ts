import { firstUse, giveBackAnonUse, HOST_KEY, json, readJson, readReleaseTicket, releaseUse } from './_lib.js'

/**
 * POST /api/ordana-widget/release { key, ticket } — a rewrite failed after its consume: give the use back.
 * The ticket came with that consume's answer (check.ts): signed, 2 minutes, usable once, and it names the
 * user ref and kind itself, so nobody can release uses they didn't spend.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  const key = typeof body?.key === 'string' ? body.key : ''
  const ticket = typeof body?.ticket === 'string' ? body.ticket : ''
  if (!HOST_KEY.test(key) || !ticket || ticket.length > 2048) return json({ error: 'invalid_request' }, 400)

  try {
    const t = await readReleaseTicket(ticket)
    if (!t || t.k !== key) return json({ error: 'invalid_ticket' }, 400)
    if (!(await firstUse(`rel_${t.n}`))) return json({ error: 'already_released' }, 409)
    await releaseUse(t.k, t.r, t.kind)
    // Our own count of the 3 signed-out tries gets the try back too.
    if (t.r.startsWith('anon_')) await giveBackAnonUse(t.r)
    return json({ ok: true })
  } catch (e) {
    console.error('ordana-widget release', e instanceof Error ? e.message : e)
    return json({ error: 'failed' }, 502)
  }
}
