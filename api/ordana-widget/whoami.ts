import { json, ordanaConnected, whoami } from './_lib.js'

/**
 * GET /api/ordana-widget/whoami — tells Ordana this server is connected, and reports (without secrets)
 * whether production runs on a live key. Returns only flags and counts.
 */
export async function GET(): Promise<Response> {
  if (!ordanaConnected()) return json({ connected: false })
  try {
    const d = await whoami()
    const widget = (d.widget ?? {}) as Record<string, unknown>
    const attachments = d.attachments ?? d.attachment_keys ?? d.hosts
    return json({
      connected: true,
      livemode: d.livemode ?? null,
      billing_live: d.billing_live ?? null,
      widget: typeof widget.name === 'string' ? widget.name : typeof widget.title === 'string' ? widget.title : null,
      hosts: Array.isArray(attachments) ? attachments.length : null,
    })
  } catch (e) {
    console.error('ordana-widget whoami', e instanceof Error ? e.message : e)
    return json({ connected: true, error: 'whoami failed' }, 502)
  }
}
