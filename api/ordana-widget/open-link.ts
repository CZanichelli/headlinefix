import { json, makerSignInLink, origin, readSession } from './_lib.js'

/**
 * POST /api/ordana-widget/open-link (Bearer widget session) — "Open HeadlineFix": a short-lived, one-time link
 * that signs this widget user straight in on our own site. 503 not_configured until SUPABASE_SERVICE_ROLE_KEY
 * is set; the embed then just opens the site.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await readSession(request)
    if (!session) return json({ error: 'signed_out' }, 401)
    const url = await makerSignInLink(session, origin(request))
    return url ? json({ url }) : json({ error: 'not_configured' }, 503)
  } catch (e) {
    console.error('ordana-widget open-link', e instanceof Error ? e.message : e)
    return json({ error: 'failed' }, 502)
  }
}
