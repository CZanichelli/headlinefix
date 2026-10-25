export type Variant = 'a' | 'b'
export type Mode = 'card' | 'page' | 'modal'

export type WidgetUser = { name: string | null; email: string | null }

/** Ordana's entitlement answer, as CZ's server passes it on. */
export type CheckResult = {
  entitled: boolean
  paywall: boolean
  checkoutUrl: string | null
  creditPackUrl: string | null
  remaining: number | null
  plan: string | null
}

/** Everything the widget needs from outside. The embed talks to the server; the preview fakes it. */
export interface WidgetBackend {
  currentUser(): WidgetUser | null
  /** Must open its popup synchronously, so call it straight from a click. */
  signIn(): Promise<WidgetUser>
  signOut(): void
  /** Ask before a use, counting it (consume: 1). */
  use(): Promise<CheckResult>
  /** Ask without counting (consume: 0), e.g. for the Billing screen. */
  status(): Promise<CheckResult>
  /** Opens Ordana's checkout in a new tab. Call straight from a click. */
  openCheckout(url: string): void
}

export class SignedOutError extends Error {
  constructor() {
    super('Please sign in again.')
  }
}
