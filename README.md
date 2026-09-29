# Provo: Evidence Intelligence Platform (PS02, Cloudinary)

Field teams upload photos and videos from a restoration project; the app checks each one (date, GPS, blur, duplicates, relevance), sorts it into accepted, review or rejected, and keeps a link from every report sentence back to the original file on Cloudinary. It runs on Next.js, Neon Postgres, Cloudinary and OpenRouter. The spec sits in `plan/` and working notes in `docs/`; neither goes into git.

Pages: dashboard, evidence, review queue, search, upload, field capture (`/capture`, camera plus GPS for phones), before/after, and reports with campaign cards.

## Run

Live: https://autobots-cloudinary.vercel.app

```powershell
npm.cmd install
npm.cmd run dev
```

`APP_BASE_URL` points at the deployment, so Cloudinary webhooks land on `https://autobots-cloudinary.vercel.app/api/cloudinary/webhook` rather than on your machine. To try `/capture` from a phone against local dev you'd need an https tunnel (browser geolocation won't run over plain http) and `APP_BASE_URL` pointed at it for the session.

## Stuck uploads (asset stays in "processing")

```powershell
npm.cmd run pipeline:stuck
npm.cmd run pipeline:process -- --asset <UUID> --llm
```

`pipeline:stuck` lists assets that are stuck, stale, failed or waiting on a metadata sync. `pipeline:process` re-runs one asset through the LLM path, so it spends no AI Vision tokens, and it reuses any AI result already saved instead of paying for it twice.

## Tests

```powershell
npm.cmd test
npm.cmd run typecheck
```

The tests run offline: they make no LLM, AI Vision or upload calls.

## Day-1 probes (historical)

Credentials live in `.env.local`; `.env.local.example` only lists the names, so never copy it over the real file. Scripts read `.env.local`, and shell environment variables override it.

```powershell
npm.cmd run day1:models
npm.cmd run day1:cloudinary
$env:LLM_MODEL_VISION = 'google/gemini-2.5-flash-lite,openai/gpt-4.1-mini,qwen/qwen3-vl-30b-a3b-instruct'
$env:LLM_MODEL_TEXT = 'google/gemini-2.5-flash-lite'
npm.cmd run day1:openrouter
```

Only the benchmark accepts a comma-separated list of vision models; the app itself takes one. These scripts upload public test fixtures and spend whatever add-on and model quota is enabled, though they never sign up for plans or change subscriptions. Results land in `artifacts/day1/` (gitignored). To keep the console output too, pipe a command to `Tee-Object artifacts/day1/cloudinary.log` once that folder exists.

`day1:cloudinary` reuses finished uploads and fills in missing fixtures; `--fresh` uploads a new five-image set, and `--tagging-only` or `--search-only` run a single probe. `day1:openrouter` takes `--retry-failed` to retry failed image validations once, or `--pair-only` to run just the chosen vision model's pair test. A malformed model reply gets one retry and then goes to `REVIEW`, so check the raw first attempt as well as the summary. A new full benchmark overwrites the old records; copy `artifacts/day1` somewhere else first if you want to keep them.

Webhook signature checks were built after these probes; they live in `app/api/cloudinary/webhook` and `lib/cloudinary.mjs` (`verifyWebhook`).
