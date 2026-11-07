import { json, ordanaConnected, whoami } from './_lib.js'

/**
 * GET /api/ordana-widget/whoami — tells Ordana this server is connected, and reports (without secrets)
 * whether production runs on a live key. Returns only flags, counts and the public OIDC client id/issuer.
 */
export async function GET(): Promise<Response> {
  if (!ordanaConnected()) return json({ connected: false })
  try {
    const d = await whoami()
    const widget = (d.widget ?? {}) as Record<string, unknown>
    const attachments = d.attachments ?? d.attachment_keys ?? d.hosts
    const oidc = (d.oidc ?? {}) as Record<string, unknown>
    return json({
      connected: true,
      livemode: d.livemode ?? null,
      billing_live: d.billing_live ?? null,
      widget: typeof widget.name === 'string' ? widget.name : typeof widget.title === 'string' ? widget.title : null,
      hosts: Array.isArray(attachments) ? attachments.length : null,
      // Both are public (the client id is in every sign-in redirect).
      oidc: {
        client_id: typeof oidc.client_id === 'string' ? oidc.client_id : null,
        issuer: typeof oidc.issuer === 'string' ? oidc.issuer : null,
      },
      // Only whether it's there; the secret itself never leaves the server.
      session_secret: typeof d.session_secret === 'string' && d.session_secret.length > 0,
    })
  } catch (e) {
    console.error('ordana-widget whoami', e instanceof Error ? e.message : e)
    return json({ connected: true, error: 'whoami failed' }, 502)
  }
}
