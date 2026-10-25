# HeadlineFix

Deliberately tiny headline-rewriting app, used to test a third-party integration flow later. Keep it simple.

## Stack

Vite, React 19, TypeScript, Tailwind v4 (`@tailwindcss/vite`), React Router, `@supabase/supabase-js`. Deployed on Vercel.

## Commands

- `npm run dev` – dev server
- `npm run build` – `tsc -b` then `vite build`
- `npm run preview`

## Env

`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `.env.local` (see `.env.example`). Never commit `.env.local`.

## Layout

- `src/features/rewrite/` – `rewrite.ts` (pure deterministic `rewriteHeadline`), `RewriteTool.tsx` (reusable UI; limits are injected via `beforeGenerate` / `onGenerated` props), `index.ts`
- `src/features/auth/` – `AuthContext.tsx` (Supabase session)
- `src/features/usage/` – free-tier counters (localStorage for anon, `usage_events` for users)
- `src/pages/` – Landing (`/`), AppPage (`/app`), Pricing, AuthPages (login/signup), Account
- `src/components/Layout.tsx` – header and outlet
- `src/lib/supabase.ts` – client
- `src/index.css` – colors as CSS variables on `:root`
- `supabase/schema.sql` – `usage_events` table, RLS (own rows only, 20/month cap on insert)

## Rules

- Rewrites stay rule-based, no AI or network calls.
- No payment code in the app itself. The Ordana widget's paid tier runs entirely on Ordana's checkout.
- Widget/embed code lives only in `src/ordana-widget/` and `api/ordana-widget/` (see `ORDANA_WIDGET.md`). No other partner API.

## Ordana widget

This product has an Ordana widget (HeadlineFix's widget on Ordana — manage it at https://platform.joinordana.com/scenario/ab5b4b1f-61d9-4db7-bb2a-ba41ae19bc5d?tab=widget — details in ORDANA_WIDGET.md). Before you finish ANY change, check it against ORDANA_WIDGET.md → What the widget depends on. If the change touches any of it — a feature the widget shows, its screens or components, pricing, plans or the free tier, sign-in, or an API the widget calls — tell the founder in one line what it affects and ask: 'Update the widget too?'. If a feature the widget uses is removed or renamed, propose how the widget should change. Price, free-use and host-share changes are never made in code alone: the founder re-confirms them in Ordana (Your widget → Change offer), and hosts already using the widget get 30 days' notice. After updating the widget, re-run the Host test in ORDANA_WIDGET.md, update ORDANA_WIDGET.md and give the founder a fresh code block to paste in Ordana (Your widget → Edit widget) — and say it goes into Ordana, not into a coding agent.
