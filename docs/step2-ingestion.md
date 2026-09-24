# Step 2: upload → verified webhook → Neon

Verified 2026-09-24. The existing Next.js server at `http://localhost:3000` and existing ngrok tunnel were reused.

## Built

- `migrations/001_evidence.sql`: all eight §16 domain tables in plain SQL; no ORM or embeddings. `assets` also retains `raw_cloudinary`, exact original `cloudinary_events`, and a unique Cloudinary asset ID for retry safety.
- `npm run step2:setup`: applies the idempotent migration and creates/checks three **signed** presets. One demo project supplies the folder until the later project UI exists.
- `/upload`: bulk Cloudinary Upload Widget; `ps02_ingest` by default, opt-in showcase toggle for `ps02_showcase`.
- `/upload?test=core`: quota-safe test UI, fixed to `ps02_core` with no showcase toggle.
- `POST /api/upload-signature`: accepts only a known preset, recent timestamp and optional widget source; rejects analysis flags, transformations, metadata overrides, overwrite and custom notification destinations.
- `POST /api/cloudinary/webhook`: verifies the original body and timestamp with Cloudinary's SDK before parsing/writing. An atomic asset-ID upsert preserves core fields, merges nested detection results and retains each distinct original notification. Database failures return retryable HTTP 503.
- `/evidence`: an image preview, EXIF, quality, pHash, etag and expandable raw payloads. Analysis remains `uploaded` / `processing`; step 3 is not implemented.

## Live evidence

Two images were uploaded using **only `ps02_core`**. Both used the public Cloudinary `park.jpg` API fixture; these are not campaign evidence. No captioning, Google tagging, AI Vision or LLM calls were made.

The first upload was correctly rejected at the webhook because the account signed notifications using another API key. After the user aligned the dedicated notification key with `CLOUDINARY_URL`, a second core upload produced a genuine Cloudinary notification through ngrok with **HTTP 200**, then the Neon row and evidence page below:

| Field | Observed value |
|---|---|
| Asset row | `e7fe161e-d8d5-42d4-bbb4-fc78a60cf0fc` |
| Cloudinary asset ID | `d7e4816b33d6bad09079a097aceffdac` |
| Public ID | `nqbfqb3tzlpritvztebl` |
| EXIF / image metadata | 64 keys, including GPSLatitude, GPSLongitude, DateTimeOriginal, Make and Model |
| Quality | `quality_analysis: { "focus": 1 }` |
| pHash | `5be9ffbe1c140281` |
| etag | `deea866a112fe313ff9b8571ddf347d7` |
| Evidence list | HTTP 200, rendered HTML includes row ID and all four required data groups |

The local `artifacts/step2/smoke.json` records the upload and exact accepted webhook payload. The original failed-delivery upload is preserved in `artifacts/step2/smoke-before-key-fix.json`. These ignored artifacts are not committed.

## Verification corrections

- **§15 webhook key:** `verifyNotificationSignature` is valid, but the relevant secret is the dedicated notification key or the account's oldest active key, which can differ from the upload key. Set Console Settings → Webhook Notifications → Select API Key to the key used by this app. [Cloudinary notification signatures](https://cloudinary.com/documentation/notification_signatures)
- **§15 metadata flag:** current SDK/presets use `media_metadata: true`; the real image response still names the field `image_metadata`. Quality supplies `focus`, not `quality_score`, so the nullable database quality score is not invented. [Upload API reference](https://cloudinary.com/documentation/image_upload_api_reference)
- A metadata-only `explicit` call on the first image returned its existing EXIF/quality/hashes but emitted no observed webhook during the bounded wait. A fresh core upload was necessary for the corrected-key proof.
- The Widget supports `clientAllowedFormats: ['image', 'video']` and function-based signed upload callbacks. [Widget reference](https://cloudinary.com/documentation/upload_widget_reference)

## How to test

1. Set `.env.local` per `.env.local.example`; keep the account notification key aligned with `CLOUDINARY_URL`.
2. Run `npm run step2:setup`, then reuse/start `npm run dev` and the configured ngrok tunnel.
3. Open `http://localhost:3000/upload?test=core`, upload a fixture, then open or refresh `http://localhost:3000/evidence`.
4. Offline checks: `npm test`, `npm run typecheck`, `npm run build`.
5. Database merge check: `node scripts/step2/db-check.mjs`. It creates/removes one synthetic row and makes no media/AI calls.
6. Live core check: `node scripts/step2/smoke.mjs`. Reuses the saved uploaded image on subsequent runs; an intentional `--fresh` performs one additional core upload.

Six offline tests, TypeScript, production build and real Neon idempotency/late-event checks passed. The live HTTP → signed Cloudinary upload → genuine webhook → Neon → server-rendered evidence path passed. **Browser visual verification and clicking the Upload Widget were unavailable:** the computer-use runtime offered no browser. Widget wiring was reviewed against official documentation; no browser success is claimed.
