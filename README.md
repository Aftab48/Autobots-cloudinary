# PS02 — Evidence Intelligence Platform (Cloudinary)

Next.js + Neon + Cloudinary + OpenRouter. The spec lives in `plan/` and working notes in `docs/`; both are kept locally and are not in git.

## Run

```powershell
npm.cmd install
npm.cmd run dev
ngrok http 3000 --url https://chase-tricolor-lunchtime.ngrok-free.dev
```

The second and third commands run in separate terminals. ngrok is required for Cloudinary webhooks.

## Stuck uploads (asset stays in "processing")

```powershell
npm.cmd run pipeline:stuck
npm.cmd run pipeline:process -- --asset <UUID> --llm
```

The first command lists stuck, stale, failed or metadata-pending assets. The second re-runs one asset through the pipeline with the LLM path (no AI Vision tokens). Saved AI results are reused, never paid for twice.

## Day-1 probes (historical)

```powershell
npm.cmd install
npm.cmd run dev
```

App: http://localhost:3000. Keep credentials in the existing `.env.local`; `.env.local.example` contains names only. Never copy the example over real credentials. Scripts load `.env.local`, while shell environment overrides take precedence.

```powershell
npm.cmd run day1:models
npm.cmd run day1:cloudinary
$env:LLM_MODEL_VISION = 'google/gemini-2.5-flash-lite,openai/gpt-4.1-mini,qwen/qwen3-vl-30b-a3b-instruct'
$env:LLM_MODEL_TEXT = 'google/gemini-2.5-flash-lite'
npm.cmd run day1:openrouter
```

Comma-separated vision IDs are supported only by the benchmark. Use a single recommended ID for the future application. Live scripts upload public test fixtures and consume enabled add-on/model quotas; they do not enroll in plans or change subscriptions. Results and full upload output go to `artifacts/day1/` (gitignored). To keep console output, pipe a command to `Tee-Object artifacts/day1/cloudinary.log` after the directory exists.

Cloudinary reuses completed uploads and fills missing fixtures; `--fresh` creates a new five-image set. Targeted probes: `npm.cmd run day1:cloudinary -- --tagging-only` or `--search-only`. OpenRouter can retry failed image validations once with `--retry-failed`, or run only the chosen vision model's pair test with `--pair-only`. Each ordinary malformed-output call retries once and then records `REVIEW`; inspect the raw first attempt as well as the final summary. A new full benchmark overwrites its previous records, so copy `artifacts/day1` elsewhere if retaining multiple experiments.

```powershell
node --test scripts/day1/schema.test.mjs
npm.cmd run typecheck
npm.cmd run build
```

The supplied `notification_url` is exercised as an upload option. Webhook receipt and signature validation belong to the next step and have not been verified here.
