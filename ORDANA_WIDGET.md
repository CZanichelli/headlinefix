# Ordana widget

HeadlineFix's headline rewriter as an Ordana widget that other products embed.
Manage it at https://platform.joinordana.com/scenario/ab5b4b1f-61d9-4db7-bb2a-ba41ae19bc5d?tab=widget

- **Embed** (what hosts mount): `https://headlinefix.vercel.app/ordana-widget/embed?key=wak_…&mode=card|page|modal`
- **Preview** (fictional data, no auth, no network): `https://headlinefix.vercel.app/ordana-widget-preview`
- **White-label**: no HeadlineFix name, logo, colours or links anywhere in the widget. Ordana appears only for
  "Continue with Ordana" and its checkout. The ⋯ menu: who you are (Continue with Ordana / name + "Signed in with Ordana ↗")
  · Settings · Plan & billing · Help · Sign out.
- **Offer** (set in Ordana, not in code): 3 rewrites without an account, then 20 more free once signed in with Ordana
  (one-time, no monthly reset), then €5/month for unlimited rewrites. Split: HeadlineFix 50% · host 40% · Ordana 10%.
  Cost guard: 5,000 free rewrites per host per month (a rewrite costs ~€0: rule-based, runs in the browser).
  The main app's own free tier (20/month) is deliberately different.

## Files (delete these to remove the widget)

| Path | What |
| --- | --- |
| `src/ordana-widget/` | All widget UI: `Widget.tsx` (shared screens), `EmbedPage.tsx` (embed + host messages), `PreviewPage.tsx`, `SignInPages.tsx` (sign-in popup), `liveBackend.ts`, `theme.ts`, `storage.ts`, `types.ts`, `widget.css`, `routes.tsx` |
| `api/ordana-widget/` | Vercel functions: `authorize.ts`, `session.ts`, `check.ts`, `whoami.ts`, shared `_lib.ts`, `_env.d.ts` |
| `supabase/ordana-widget.sql` | Sign-in relay table + two functions, signed-out use counter table + two functions (run in the Supabase SQL editor; safe to re-run) |
| `src/App.tsx` | Two lines: import and render `ordanaWidgetRoutes` |
| `vercel.json` | SPA rewrite skips `/api/`; `frame-ancestors *` header on `/ordana-widget/embed` |
| `tsconfig.json` | `"api"` added to `include` |
| `.env.example` | The Ordana variables below |
| `CLAUDE.md` | "Ordana widget" section, and the widget lines under Layout and Rules |

## Environment variables (Vercel → Project → Settings → Environment Variables → Production)

| Name | Set when | What |
| --- | --- | --- |
| `ORDANA_WIDGET_KEY` | Required (Your widget → Connect your server) | Server key, the only Ordana variable. `wsk_live_…` in Production, `wsk_test_…` only locally. Also sent as the OIDC client secret unless `ORDANA_OIDC_CLIENT_SECRET` is set. Without it the widget runs unmetered, nothing is counted and sign-in is off. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Already set for the app | Also used server-side by the sign-in relay (`SUPABASE_URL` / `SUPABASE_ANON_KEY` override them). |
| `ORDANA_API_URL`, `ORDANA_OIDC_CLIENT_SECRET` | Optional overrides | Default to Ordana's entitlement endpoint and `ORDANA_WIDGET_KEY`. |

Redeploy after adding or changing any of them. `ORDANA_WIDGET_SESSION_SECRET` and `ORDANA_OIDC_CLIENT_ID` are no longer read
and can be deleted from Vercel.

**From Ordana's whoami** (fetched with the server key when an instance starts, cached 10 minutes, a failed fetch is retried
on the next request):

- `oidc.client_id`, `oidc.issuer`: "Continue with Ordana". Redirect URI: `https://headlinefix.vercel.app/ordana-widget/callback`
- `session_secret`: signs the widget's own sessions. Not derived from `ORDANA_WIDGET_KEY`, so rotating the key (create new →
  deploy → revoke old) signs nobody out. If Ordana changes `session_secret`, everyone is signed out within 10 minutes.
  While whoami can't be reached, sign-in shows "not available" and signed-in checks fail with a retryable error (nobody is signed out).

## How it works

- `Widget.tsx` renders every screen. It gets a `WidgetBackend`: the embed's talks to `/api/ordana-widget/*`, the preview's is fake.
- **Load check**: on load the embed asks `check` once with `consume: 0` (counts the impression, spends nothing) for the
  same `end_user_ref` as the rewrite check, and asks again after sign-in or sign-out because the ref changes. It reads
  `variant` (`"b"` → version b, anything else → a, the control) and `variant_round`, and keeps the answer for the session per
  ref (`ow_load:<ref>` in session storage). Only a real answer is kept: a failed or slow (>4s) check shows version a and is
  asked again on the next load. It shows "Not available here any more" at once when the reason is `attachment_removed`,
  `host_disabled` or `widget_retired`.
- **Every rewrite** calls `check` with `consume: 1`, signed in or not. `end_user_ref` is the Ordana `sub` (`oid_…`) once signed
  in, else `anon_<random visitor id>` (in storage, or per page load when storage is blocked). Never an email or our own id.
  **Signed out, the server counts the 3 free tries itself** per anon ref (`ordana_widget_anon_uses` in Supabase,
  `ANON_FREE_TRIES` in `api/ordana-widget/_lib.ts`): it takes one try, then asks Ordana as usual, and gives the try back when
  Ordana says no or errors. After 3 it answers `sign_in_required` (reason `anon_free_tries_used`) without asking Ordana. If the
  counter can't be reached or `supabase/ordana-widget.sql` hasn't been run, signed-out rewrites fail closed (never silently
  uncounted). A visitor who clears storage gets a new anon ref, as with Ordana's own count. The hint reads "X of 3 free tries
  left" while signed out; signed in, Ordana's `remaining` / `free_remaining` applies unchanged.
  Ordana enforces the rest: `sign_in_required` → the sign-in step ("Continue with Ordana", or "Continue with Ordana to
  buy" when it is also a paywall); `paywall` + `checkout_url` → "Upgrade for unlimited" opens exactly that URL in a new tab.
  Network errors, 5xx and 429 are retried with backoff, then the request fails closed.
- **Disconnected in Ordana**: when a signed-in check answers reason `consent_withdrawn` or `unknown_ordana_id`, the person
  disconnected the widget in their Ordana account. `check` answers `401 { error: "disconnected" }`, the embed drops its session
  at once and shows the sign-in step ("Continue with Ordana", saying the widget was disconnected), never "Not available right
  now". Plan & billing does the same. Sessions are stateless, so dropping the embed's token ends it; Ordana refuses the old `sub` anyway.
- **Sign-in** ("Continue with Ordana" only): the embed picks a random `state` and opens a popup at
  `/ordana-widget/signin?host=wak_…&state=…` (makes PKCE + nonce) → `/api/ordana-widget/authorize` → Ordana → `/ordana-widget/callback`.
  The callback POSTs the code to `/api/ordana-widget/session`, which exchanges it, verifies the ID token (ES256 via JWKS,
  iss/aud/exp/nonce), signs a session and parks it under `state` (Supabase, `supabase/ordana-widget.sql`, 10-minute life,
  read once). The embed polls `GET /api/ordana-widget/session?state=…` every 2s for up to 5 minutes (and on focus/visibility);
  the popup's postMessage only makes it ask at once. The widget updates in place, no reload. No user table: identity is `sub`.
  In white-label mode the email may be a `@hidden.id.joinordana.com` stand-in: it is never shown and never mailed.
- `/api/ordana-widget/whoami` reports only `livemode`, `billing_live`, the widget name, the number of hosts and the public
  `oidc.client_id` / `oidc.issuer`, and `session_secret: true/false` (whether Ordana sent one, never its value).
- **Theme** URL parameters (`theme, accent, accent_text, bg, surface, text, muted, border, radius, font, frame=none, host, fit=fill`)
  set the `--widget-*` CSS variables in `theme.ts`. The embed posts `{ type: "ordana-widget:resize", height }` on every size change.

## Shared context (ui.context)

Browser-only, between the host page and the embed; never through Ordana. On load the embed posts
`{ type: "ordana-widget:ready", v: 1 }` to its parent.

| Direction | Field | Use |
| --- | --- | --- |
| in | `draft_title` (string, ≤200) | Prefills "Your headline" with the draft's working title |
| in | `audience` (string, ≤80) | Prefills "Who is it for?" with the publication's audience |
| out | `chosen_headline` (string) | The rewrite the user picked ("Use this") |
| out | `chosen_style` (`benefit`/`question`/`punchy`) | Its style |

- In: accepted only from `window.parent`, `type: "ordana-widget:context"`, `v: 1`. Other keys are dropped. Shown with a
  "From <host>" tag and one "Don't use" link. A prefill never runs a rewrite.
- Out: after the first result the widget asks once "Keep <host> updated with your results?" (remembered per user on this
  site, changeable in Settings). Only after Yes, "Use this" posts `{ type: "ordana-widget:result", v: 1, fields }` to the
  host's remembered origin, never `"*"`. No context message from the host means nothing is ever sent.
- No server endpoint: rewrites aren't stored, so there is nothing for a host's server to fetch.
- The JSON handed to Ordana also lists `author_email` under `ui.context.in`. That is a deliberate test that Ordana refuses
  banned fields. It is not built into the embed or the preview, and the embed drops it. Remove it from the JSON if Ordana
  accepts it.

## Versions

| Key | Name | What changes |
| --- | --- | --- |
| a | Headline + audience | Headline and optional "Who is it for?" fields both visible; button "Rewrite it" below them. |
| b | One field | Only the headline field, with a bolder "Fix my headline" beside it; the audience field sits behind "+ Add audience". |

Price, free rewrites and the paywall are the same in both. Ordana picks the version per user (`variant`, `variant_round`
in the load check); the embed never picks one itself, except version a when the load check fails.

## What the widget depends on

- **Rewrite logic**: `src/features/rewrite/rewrite.ts` (`rewriteHeadline`, its three styles, ids and labels: benefit/Benefit-first, question/Question, punchy/Short & punchy). `chosen_style` sends these ids to hosts.
- **Free tier and price wording**: `ANON_FREE_TRIES` (3, enforced) in `api/ordana-widget/_lib.ts`; `FREE_TRIES` (3) and `FREE_WITH_ACCOUNT` (20) in `src/ordana-widget/Widget.tsx` (sign-in step, hints, Plan & billing, Help) mirror the offer in Ordana. The app's own tiers live in `src/pages/Pricing.tsx` and `src/features/usage/usage.ts` (different on purpose).
- **Sign-in**: "Continue with Ordana" only (`src/ordana-widget/SignInPages.tsx`, `src/ordana-widget/liveBackend.ts`, `api/ordana-widget/authorize.ts`, `api/ordana-widget/session.ts`, `supabase/ordana-widget.sql`). It does not use the app's Supabase auth.
- **API routes it calls**: `/api/ordana-widget/check`, `/api/ordana-widget/session`, `/api/ordana-widget/authorize` (all internal, not for hosts) and Ordana's entitlement check (`api/ordana-widget/_lib.ts`).
- **Hosting**: `vercel.json` (rewrite + framing header).

## Host test

Run this after every change to the widget, against **production**:

1. **Declared = built.** In the embed, every ⋯ menu item works (who you are, Settings, Plan & billing, Help, Sign out). The only sign-in anywhere is "Continue with Ordana". There is no HeadlineFix name, logo or link on any screen. Check both versions; price, free rewrites and paywall must be the same in each.
2. **Framing.** Frame the production embed from another origin (a local HTML page served over http) with the resize listener, in a private window, logged out. Repeat with third-party storage blocked: it must not crash.
3. **Widths.** Test 280, 390, 768 and 1200px, and drag between them. There should be no empty block under the widget, no inner scrollbar, no narrow centred column, and nothing cut off. The ⋯ menu must fit.
4. **Looks.** Test light in a white card; `theme=dark&frame=none&bg=<card colour>` in a dark card; and dark with `frame=none` in a white card. Everything must stay readable. Then try `accent=9fe3d6` (pale): button text must stay readable.
5. **Shared context.** Send `{type:"ordana-widget:context",v:1,fields:{draft_title,audience,author_email}}`. The two declared fields prefill with "From <host>", `author_email` is ignored, and nothing runs until you click. "Don't use" clears them. After Yes to "Keep <host> updated", "Use this" delivers `ordana-widget:result` with only `chosen_headline` and `chosen_style`.
6. **Journey.** Use 3 rewrites without an account. The 4th shows the sign-in step, also after reloading the embed, and Ordana counts no 4th use; "Continue with Ordana" (once with Google, once with an email code) closes the popup and shows the results without a reload. Use up the 20, and the paywall appears inside the widget: signed out it says "Continue with Ordana to buy", signed in "Upgrade for unlimited" opens Ordana's checkout. Then try a second fresh visitor in another browser. Sign out, then sign in again (one tap). While signed in, disconnect the widget in your Ordana account: the next rewrite signs you out and shows "Continue with Ordana" (not "Not available right now"), and continuing signs you back in. Finally, an embed URL with no key should show a clear message.
7. **Live key.** With the server key set, `/api/ordana-widget/whoami` answers `livemode: true`, and one real rewrite in the embed shows up in Ordana.
