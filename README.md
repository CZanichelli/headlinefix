# HeadlineFix

Tiny web app: paste a headline, get 3 rule-based rewrites (benefit-first, question, short & punchy). No AI, no external API calls.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (a `sb_publishable_...` key works).
3. Run `supabase/schema.sql` in the Supabase SQL editor.
4. In Supabase Auth settings, keep email confirmation off.
5. `npm run dev`

## Commands

- `npm run dev` – dev server
- `npm run build` – type-check and build to `dist/`
- `npm run preview` – serve the build

## Deploy

Vercel. `vercel.json` rewrites all paths to `index.html` so deep links work. Set the two `VITE_` env vars in the Vercel project.

## Limits

- Logged out: 3 free rewrites per browser (localStorage).
- Signed in: 20 rewrites per calendar month (UTC), one `usage_events` row each; also enforced by the RLS insert policy.
- Pro (€9/month) is a placeholder: "Coming soon".
