export type Variant = 'a' | 'b'
export type Mode = 'card' | 'page' | 'modal'

/** `id` is the Ordana subject (oid_…). The email may be a stand-in that receives no mail; never shown or mailed. */
export type WidgetUser = { id: string; name: string | null; email: string | null }

/** Ordana's entitlement answer, as CZ's server passes it on. */
export type CheckResult = {
  entitled: boolean
  paywall: boolean
  /** A visitor who hasn't signed in: Ordana wants "Continue with Ordana" first (more free uses, or to buy). */
  signInRequired: boolean
  checkoutUrl: string | null
  creditPackUrl: string | null
  /** Subscribers' "Manage payment in Ordana" link. */
  manageUrl: string | null
  /** Why not entitled, e.g. "host_cap_reached". */
  reason: string | null
  remaining: number | null
  plan: string | null
}

/** Everything the widget needs from outside. The embed talks to the server; the preview fakes it. */
export interface WidgetBackend {
  currentUser(): WidgetUser | null
  /** Must open its popup synchronously, so call it straight from a click. Rejects with "cancelled" on abort. */
  signIn(signal?: AbortSignal): Promise<WidgetUser>
  signOut(): void
  /** Ask before a use, counting it (consume: 1). Works signed out too. */
  use(): Promise<CheckResult>
  /** Ask without counting (consume: 0), e.g. for the Plan & billing screen. */
  status(): Promise<CheckResult>
  /** Opens Ordana's checkout in a new tab. Call straight from a click. */
  openCheckout(url: string): void
}

/** The fields declared in ui.context.in. A host may send nothing else; anything else is dropped. */
export type HostContext = { draft_title?: string; audience?: string }

/** The fields declared in ui.context.out. */
export type HostResult = { chosen_headline: string; chosen_style: string }

/** The shared-context link with the host page. `canSend` is false until the host has sent its context. */
export type HostBridge = {
  context: HostContext | null
  canSend: boolean
  send(result: HostResult): void
}

export const NO_BRIDGE: HostBridge = { context: null, canSend: false, send: () => {} }

/** Load-check reasons that mean the widget is switched off on this host. */
export const GONE_REASONS = new Set(['attachment_removed', 'host_disabled', 'widget_retired'])

/** `disconnected`: the person disconnected this widget in their Ordana account (consent_withdrawn / unknown_ordana_id). */
export class SignedOutError extends Error {
  constructor(readonly disconnected = false) {
    super('Please sign in again.')
  }
}
