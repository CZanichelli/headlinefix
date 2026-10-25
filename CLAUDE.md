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
- Out of scope for now: widget/embed/iframe/partner API code, real payments.
