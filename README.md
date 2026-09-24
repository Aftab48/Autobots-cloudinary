# PS02 Day-1 checks

Minimal Next.js App Router + TypeScript scaffold and server-side account probes. This implements only plan §18 Day-1 checks; no evidence pipeline, database schema, upload endpoint, or webhook receiver is built yet.

See [the measured findings](docs/day1-checks.md), [observed response shapes](docs/day1-response-shapes.json), and the [project specification](plan/PS02_Project_Structure_Analysis_plan.md).

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
