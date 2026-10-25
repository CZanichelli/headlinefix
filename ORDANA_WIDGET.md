# Ordana widget

HeadlineFix's headline rewriter as an Ordana widget that other products embed.
Manage it at https://platform.joinordana.com/scenario/ab5b4b1f-61d9-4db7-bb2a-ba41ae19bc5d?tab=widget

- **Embed** (what hosts mount): `/ordana-widget/embed?key=wak_…&mode=card|page|modal`
- **Preview** (fictional data, no auth, no network): `/ordana-widget-preview`
- White-label: no HeadlineFix name, logo, colours or links anywhere in the widget. The ⋯ menu is
  Account · Billing · Settings · Help, ending in "Made on Ordana".
- Offer (set in Ordana, not in code): 20 free rewrites a month, then €5/month for unlimited rewrites.
  Host share 40%, Ordana 10%, HeadlineFix 50%. Cost guard: 2,000 free rewrites per host per month.

## Files (delete these to remove the widget)

| Path | What |
| --- | --- |
| `src/ordana-widget/` | All widget UI: `Widget.tsx` (shared screens), `EmbedPage.tsx`, `PreviewPage.tsx`, `SignInPages.tsx` (sign-in popup), `liveBackend.ts`, `theme.ts`, `storage.ts`, `types.ts`, `widget.css`, `routes.tsx` |
| `api/ordana-widget/` | Vercel functions: `authorize.ts`, `session.ts`, `check.ts`, `whoami.ts`, shared `_lib.ts`, `_env.d.ts` |
| `src/App.tsx` | Two lines: import and render `ordanaWidgetRoutes` |
| `vercel.json` | SPA rewrite skips `/api/`; `frame-ancestors *` header on `/ordana-widget/embed` |
| `tsconfig.json` | `"api"` added to `include` |
| `.env.example` | The Ordana variables below |
| `CLAUDE.md` | "Ordana widget" section |

## Environment variables (Vercel → Project → Settings → Environment Variables → Production)

| Name | Set when | What |
| --- | --- | --- |
| `ORDANA_WIDGET_KEY` | Required (Your widget → Connect your server) | Server key. `wsk_live_…` in Production, `wsk_test_…` only locally. It is also the OIDC client secret and (by default) the session-signing secret. Without it the widget runs unmetered and nothing is counted. |
| `ORDANA_API_URL` | Optional override | Entitlement endpoint; defaults to Ordana's `widget-entitlements` function. |
| `ORDANA_OIDC_ISSUER`, `ORDANA_OIDC_CLIENT_ID`, `ORDANA_OIDC_CLIENT_SECRET` | Optional overrides | Default to Ordana's issuer, this widget's client id, and `ORDANA_WIDGET_KEY`. Redirect URI: `https://headlinefix.vercel.app/ordana-widget/callback` |
| `ORDANA_WIDGET_SESSION_SECRET` | Optional | Separate secret for widget sessions. If it isn't set, one is derived from `ORDANA_WIDGET_KEY`, so rotating the key signs everyone out of the widget. |

Redeploy after adding or changing any of them.

## How it works

- `Widget.tsx` renders every screen. It gets a `WidgetBackend`: the embed's talks to `/api/ordana-widget/*`, the preview's is fake.
- Sign-in: a popup opens `/ordana-widget/signin?host=wak_…` (makes the PKCE pair and a nonce) → `/api/ordana-widget/authorize` → Ordana
  (with `&host=` the attachment key) → `/ordana-widget/callback`, which posts the code to the embed (same origin only). The embed sends it to
  `/api/ordana-widget/session`. That endpoint exchanges the code, verifies the ID token's ES256 signature against Ordana's JWKS plus
  iss/aud/exp/nonce, and returns a signed session. Identity is the Ordana `sub` (`oid_…`); there is no user table.
  If the token exchange returns `invalid_grant` (consent withdrawn), the user stays signed out.
- Before every rewrite the embed calls `/api/ordana-widget/check` with `consume: 1`; the server sends
  `{ action: "check", attachment_key, end_user_ref: sub, consume }` to Ordana. Ordana counts the use, enforces the free rewrites and
  returns `checkout_url` for the paywall (opened in a new tab) or a reason, which the widget shows as "Not available right now".
  It also returns `manage_url` for subscribers, shown as "Manage billing". Network errors, 5xx and 429 responses are retried with backoff, then the request fails closed.
  Answers with `consume: 0` are cached for `cache_ttl_s`. Nothing is released, because a rewrite can't fail after it is counted
  (the existing rule-based `rewriteHeadline` runs in the browser).
- `/api/ordana-widget/whoami` calls Ordana's `whoami` and reports only `livemode`, `billing_live`, the widget name and the number of hosts.
- A/B versions: on load the embed calls `check` with `consume: 0` and reads `variant`. Anything other than `"b"` means version a.
  The version is kept for the session.
- The theme URL parameters (`theme, accent, accent_text, bg, surface, text, muted, border, radius, font, frame=none, host, fit=fill`)
  set the `--widget-*` CSS variables in `theme.ts`. The embed posts `{ type: "ordana-widget:resize", height }` to its parent on every size change.

## Versions

| Key | Name | What changes |
| --- | --- | --- |
| a | Headline + audience | Headline and optional "Who is it for?" fields both visible; button "Rewrite it" below them. |
| b | One field | Only the headline field, with "Fix my headline" beside it; the audience field sits behind "+ Add audience". |

Price, free rewrites and the paywall are the same in both.

## What the widget depends on

- **Rewrite logic**: `src/features/rewrite/rewrite.ts` (`rewriteHeadline`, its three styles and labels: Benefit-first, Question, Short & punchy)
- **Free tier and price wording**: "20 rewrites a month" and "unlimited" in `src/ordana-widget/Widget.tsx` (gate panel, Help), mirroring `src/pages/Pricing.tsx` and `src/features/usage/usage.ts`
- **Sign-in**: "Continue with Ordana" only (`src/ordana-widget/SignInPages.tsx`, `api/ordana-widget/authorize.ts`, `api/ordana-widget/session.ts`). It does not use the app's Supabase auth.
- **API routes it calls**: `/api/ordana-widget/check`, `/api/ordana-widget/session`, `/api/ordana-widget/authorize` and Ordana's entitlement check (`api/ordana-widget/_lib.ts`)
- **Hosting**: `vercel.json` (rewrite + framing header)

## Host test

Run this after every change to the widget, against **production**:

1. Every ⋯ menu item works in the embed (Account, Billing, Settings, Help). The menu ends with "Made on Ordana", and "Ordana" opens https://joinordana.com in a new tab. There is no HeadlineFix name, logo or link on any screen. Check both versions; price, free rewrites and paywall must be the same in each.
2. Frame the production embed from another origin (a local HTML page served over http) with the resize listener, in a private window, logged out. Repeat with third-party storage blocked: it must not crash.
3. Test widths 280, 390, 768 and 1200px, and drag between them. There should be no empty block under the widget, no inner scrollbar, no narrow centred column, and nothing cut off.
4. Test three looks: light in a white card; `theme=dark&frame=none&bg=<card colour>` in a dark card; and dark with `frame=none` in a white card. Everything must stay readable. Then try `accent=9fe3d6` (pale): button text must stay readable.
5. Run the journey: headline → "Continue with Ordana" (the popup returns, signed in) → results. Use up the free rewrites: the paywall appears inside the widget, and "Upgrade for unlimited" opens Ordana's checkout. Then a second fresh visitor in another browser. Sign out, then sign in again (one tap). Finally, an embed URL with no key should show a clear message.
6. With the server key set: `whoami` reports livemode, and one real rewrite in the embed shows up in Ordana.
