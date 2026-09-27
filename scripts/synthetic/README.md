# Synthetic riverbank fixtures

These images are artificial fixtures, never real field evidence. `.env.local` must contain `OPENROUTER_API_KEY` and an editing-capable `LLM_MODEL_IMAGE`; no model ID is hardcoded. `data/synthetic/` is gitignored. Raw generator bytes and the complete response are preserved in `raw/`; never remove provider-added watermarks or provenance.

```powershell
npm.cmd run synthetic:models
# Verify selected model's image editing support in OpenRouter model documentation.
npm.cmd run synthetic:generate -- --run --shot A-main-before
npm.cmd run synthetic:generate -- --run --shot B-main-before
npm.cmd run synthetic:generate -- --run --shot C-main-before
# Inspect those raw references before producing edits.
npm.cmd run synthetic:generate -- --run --shot A-alt-before
# Inspect A-alt-before, then generate remaining shots, using cached before images.
npm.cmd run synthetic:generate -- --run --all
npm.cmd run synthetic:prepare
npm.cmd run synthetic:verify
npm.cmd run synthetic:costs
npm.cmd run synthetic:test
# Only after preparation + verification: exactly the three authorized core uploads.
node scripts/synthetic/upload.mjs --run
```

Generation uses the `openai` SDK pointed at OpenRouter, calling its dedicated `/images` endpoint through `client.post` (the standard `images.generate` method targets a different route). Model discovery uses `/images/models`. Requests use 2K, 4:3 and one output; final JPEGs are 1600×1200. Every after passes the exact raw before image as its editing reference; other views use the site's main before image for consistency. Model editing does not guarantee pixel-identical preservation, so visually inspect all four pairs.

Inspect unusable shots and record their IDs for a separate regeneration decision. For an intentional paid regeneration, first improve that shot's prompt in `shotlist.json`, then run `npm.cmd run synthetic:generate -- --run --shot A-alt-before --regenerate`. This is single-shot only; `--all --regenerate` and unknown flags are rejected. Previous raw images, responses and costs remain preserved, and new files use `-v2`, `-v3`, etc. The latest completed version is used by preparation. Started/failed attempts remain blocked because their charges may be ambiguous; regeneration never bypasses that protection.

If regenerating a before, explicitly regenerate its paired after next using the same flag; preparation/verification rejects afters referencing an older before. Regenerating an activity used for the blur edge similarly requires an intentional derivative refresh. Re-run preparation and verification afterward. Do not delete ledger entries or raw files. The upload checker refuses changed bytes for already-uploaded fixtures, so regeneration does not authorize extra uploads.

`--all` is an explicit paid operation: 29 model calls plus one local blur derivative. Generations run sequentially, with SDK retries disabled. Successful cached output is reused. Started or failed attempts cannot automatically repeat: investigate the ledger and saved response before deciding whether to recover an existing response or explicitly regenerate. A process lock prevents concurrent generation. Never delete it until its process has stopped. `costs.mjs` reconciles missing costs with read-only generation metadata; unknown costs stay explicitly unknown.

`prepare.mjs` converts to JPEG using sharp, retains XMP/ICC where supported and writes standard EXIF using pure-JS piexifjs. DateTimeOriginal stores local wall time and OffsetTimeOriginal stores `+05:30`; no-GPS contains no GPS tags. No-EXIF deliberately contains no EXIF, including Make/Model labels, so its `.synthetic.jpg` name and manifest retain its identity. The manifest capture fields reflect actually embedded metadata; `scenario_capture_date` records the separate scenario-only date. JPEG derivatives may invalidate cryptographic credentials; the raw bytes remain the untouched source.

The blur edge uses local non-generative `sharp.blur(45)` on ACT-10. A Cloudinary blur requires remote ingestion of that private local source, which would exceed the user-authorized three uploads. This is recorded in the ledger; no additional Cloudinary upload is made.

`verify.mjs` exports `verifyDataset()` for upload scripts and runs as a CLI. It checks every manifest row against the shotlist and EXIF readback, plus labels, GPS refs, offsets, dimensions, prepared file hashes and raw hashes. Output files are `data/synthetic/<shot-id>.synthetic.jpg`; paths in `manifest.csv` and `preparation-report.json` are relative to `data/synthetic/`.

Offline tests create tiny in-memory images only: no model calls, uploads, add-ons or AI Vision. Live upload/pipeline validation is separately restricted to `A-main-before`, `EDGE-01-no-gps` and `EDGE-03-outside-date`, using `ps02_core` and forced LLM analysis.
