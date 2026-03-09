# Memory Lane

Memory Lane Operations Portal

Production-ready internal operations app for adult day center workflows, replacing AppSheet with a role-secure, mobile-first web portal.

## Tech Stack

- Next.js (App Router) + React + TypeScript
- Supabase Auth + PostgreSQL
- Tailwind CSS
- Server Actions + Server Components

## Implemented Modules

- Dashboard / Home
- Time Card (clock in/out, history, exceptions, manager biweekly review)
- Documentation (participation log + tracker dashboards)
- Health Unit (MAR and blood sugar views)
- Ancillary Charges
- Sales Activities (lead intake, stage pipeline, referral source views)
- Reports (timely docs, care tracker, last toileted)
- PTO Request (external PrismHR link)

## Local Setup

1. Install Node.js 20+.
2. Install dependencies:
   - `npm install`
3. Copy env template:
   - `cp .env.example .env.local`
4. Start app:
   - `npm run dev`

## Local Dev Performance Modes

- `npm run dev`
  - Fast default local mode using Turbopack.
- `npm run dev:webpack`
  - Webpack fallback if Turbopack is not desirable for a specific debugging case.
- `npm run dev:mem`
  - Webpack dev with increased Node memory (`--max-old-space-size=4096`).
- `npm run dev:mem:turbo`
  - Turbopack dev with increased Node memory (`--max-old-space-size=4096`).

Notes:
- `next.config.ts` includes development watch ignores for heavy/non-source paths (`.mock-state`, spreadsheet/PDF/Doc files, `.next`, `.git`, `node_modules`) to reduce watch overhead.
- TODO: If future spreadsheet/PDF ingestion is added into the repo, keep raw imports under a non-source folder (for example `data-imports/`) so they stay outside hot-reload watch scope.

## Run Modes

### Local mock mode (no Supabase required)

1. Set `NEXT_PUBLIC_USE_MOCK_DATA=true` in `.env.local`.
2. Leave Supabase URL/key empty.
3. Run `npm run dev`.

### Real backend mode (future)

1. Set `NEXT_PUBLIC_USE_MOCK_DATA=false` in `.env.local`.
2. Set required Supabase values:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Run `npm run dev`.

## Environment Variables

See `.env.example`:

- `NEXT_PUBLIC_USE_MOCK_DATA`
- `NEXT_PUBLIC_MOCK_ROLE`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_PTO_URL`

## Folder Structure

```text
/app
  /(auth)/login
  /(portal)
    /documentation
      /activity
      /toilet
      /shower
      /transportation
      /blood-sugar
    /time-card
    /health
    /ancillary
    /sales
    /reports
    /pto
  /api/health
/components
  /forms
  /ui
/lib
  /services
  /supabase
/supabase
  /migrations
/docs
```



## Town Square Brand Theme
- Primary Blue: #8099B6`r
- Dark Blue: #1B3E93`r
- Light Blue: #D4EEFC`r
- Grey Text: #4E4E4E`r
- Accent Green: #99CC33`r
- Typography: Avenir (Black/Medium/Book fallbacks configured in portal theme overrides)


