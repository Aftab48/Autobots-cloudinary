# PS02 — AI-Powered Impact & Sustainability Media Platform
## Project Plan (self-contained)

> **Hackathon:** Code Cubicle 6.0
> **Problem Statement:** PS02 — Cloudinary
> **Team:** 2 people
> **Working concept:** Cloudinary-native evidence platform for sustainability/impact campaigns

### How to read this document

- This is the single source of truth for the project. It does not depend on any other file.
- Everything is **decided** unless marked **TBD** (§4) or **(verify)**. "(verify)" means a Cloudinary feature or API detail that must be confirmed against our account or the current docs before relying on it.
- **Scope is fixed by §17.** Anything not in the MVP spine is stretch or cut.
- Code snippets and URLs are starting points, not tested code.

---

# 1. Problem Statement (official)

NGOs, governments, and sustainability organizations generate large volumes of photos and videos from field projects, environmental initiatives, infrastructure work, and community programs. Manually organizing, analyzing, verifying, and turning this media into meaningful evidence and reports is time-consuming and difficult to scale.

The challenge is to build an AI-powered media intelligence platform **using Cloudinary** that can understand field media, organize evidence by project, location, and timeline, and help teams turn visual data into reliable insights and impact stories.

**Goal — build a complete platform that can:**

1. Analyze and intelligently organize large collections of image and video evidence.
2. Identify relevant projects, activities, locations, and visual signals from media.
3. Compare before-and-after media to demonstrate visible project or environmental changes.
4. Generate visual reports, summaries, and campaign-ready content from collected evidence.
5. Make media searchable through AI-powered metadata, tagging, and semantic discovery.
6. Preserve traceability to the original source assets **and transformations**.

**Expected outcome:** a scalable media intelligence product that transforms raw field media into searchable evidence, measurable impact, and compelling visual stories.

Source: Code Cubicle 6.0 Problem Statements PDF, PS02.

---

# 2. Our Understanding

The problem is **not** "upload photos and generate an AI summary". It is:

> **How do we collect, validate, deduplicate, classify, organize, search and transform a very large amount of field media into trustworthy evidence with minimum manual effort?**

A real campaign produces hundreds or thousands of assets over months:

```text
River Restoration Campaign
  +-- January   120 photos,  8 videos
  +-- February  180 photos, 12 videos
  +-- March     240 photos, 15 videos
  +-- ...
```

Manually inspecting, categorizing, verifying, tagging and reporting on all of that doesn't scale. So we build an **evidence intelligence pipeline**, not an AI gallery.

Three principles drive the whole plan:

1. **Cloudinary does the media work.** The problem statement says "using Cloudinary", and goal 6 uses Cloudinary's own vocabulary ("transformations"). Judges will look for depth and visibility of Cloudinary usage, so we don't rebuild what Cloudinary already does.
2. **Evidence first, story second.** Every generated claim must be traceable to source assets.
3. **AI assists verification.** Uncertain cases are surfaced for human review rather than blindly accepted or discarded.

---

# 3. Product Definition

> Organizations create a project and upload field photos and videos in bulk. Cloudinary ingests, analyzes, tags, checks quality and fingerprints every asset. Our layer organizes assets by project, site, activity and timeline. It routes uncertain assets to human review and turns accepted media into searchable evidence. It supports before/after comparison and generates reports and campaign content in which every claim links to the Cloudinary asset and transformation behind it.

**Core hierarchy:**

```text
RAW MEDIA -> CLOUDINARY ANALYSIS -> EVIDENCE -> REVIEWED EVIDENCE -> CITED INTELLIGENCE -> IMPACT STORY
```

Not: `Photos -> LLM -> Fancy Summary`.

---

# 4. Constraints & Unknowns

| Item | Status |
|---|---|
| Team size | 2 people |
| Hackathon duration | **TBD**. The scope in §17 assumes ~24–48h of build time. |
| Judging criteria | **TBD**. Get the rubric and re-check §17 against it. |
| Cloudinary plan / add-on quotas | **Checked 2026-09-24:** Free, 25 credits; usage API reports Google tagging limit 50, `cloudinary_ai` limit 15, object detection limit 500. All five uploads returned completed Google tags and captioning. Usage counters lag; these limits are returned API units, not a claim that AI Vision is enabled. |
| Visual Search enabled on our account? | **Probe 2026-09-24:** restoration query, positive-control "red flowers", and self `image_asset_id` all return HTTP 200 with zero results. Retrieval/indexing is unproven; see `docs/day1-checks.md`. Current docs call this Enterprise-only. Do not choose the search design from HTTP 200 alone. |
| Cloudinary AI Vision (Analyze API) available, and its quota? | **Enabled and verified 2026-09-24:** eight HTTP 200 calls on three existing fixtures (tagging + general on all three, before/after questions on fixtures 1/2). Response quota is **100,000 tokens**, **7,467 used**, **92,533 remaining**. Usage is under `limits.addons_quota`, **not `limits.items`**. Measured tagging + general averages **1,626.67 tokens/asset → about 61 assets/month**; pair questions add **2,587 tokens/pair**. See §10.2 and `docs/day1-checks.md` for assumptions and exact per-call values. |
| LLM provider | **Tested 2026-09-24:** OpenRouter. Recommend `LLM_MODEL_VISION=openai/gpt-4.1-mini` and `LLM_MODEL_TEXT=google/gemini-2.5-flash-lite`; see five-image benchmark and limitations in `docs/day1-checks.md`. Existing `.env.local` was preserved; values are recommendations, not silently written. |
| Demo dataset | Five Cloudinary public demo images are API smoke-test fixtures only, including irrelevant images. They are not a restoration dataset or a genuine same-site before/after pair; production/demo sourcing remains **open** (§19). |

---

# 5. User Workflow

## Step 1 — Create a project

Example (used throughout this document and in the demo):

```text
Project name:   River Restoration — Kolkata
Organization:   Green Bengal NGO (fictional demo org)
Campaign type:  Environmental Restoration
Location:       Kolkata, West Bengal
Start date:     01 January 2026
End date:       30 June 2026
Description:    Riverbank cleanup, restoration and community participation campaign.
Activities:     river_cleanup, waste_removal, tree_plantation,
                infrastructure, community_participation
Sites:          Site A, Site B, Site C
```

The project is the parent entity for all evidence. **Activities are configured per project.** Each campaign type offers a default activity list that the user can edit. The AI must classify into this list (or `other`).

## Step 2 — Collect field media

Users do not categorize assets one by one. Upload paths:

- **Bulk upload** (Cloudinary Upload Widget): gallery, folders, multiple files, photos and videos.
- **Field capture page:** a phone-friendly web page that opens the camera and records GPS and time at capture (§8.3).
- **Optional batch context** at upload time: site, activity hint, and date if known. This applies to the whole batch, not per file.

The platform fills in everything else automatically from:

- EXIF timestamp, GPS and device metadata (Cloudinary `image_metadata`)
- Capture-page GPS and time
- Batch context supplied by the user
- Project context (dates, activities, sites)
- AI visual analysis
- Upload time (last-resort fallback)

## Step 3 — Automatic evidence pipeline

No manual step per asset. See §7.

---

# 6. Cloudinary-First Architecture

**Rule:** before writing code for any media task, check whether Cloudinary already does it with an upload parameter, a transformation or an API.

## 6.1 Problem-statement goals → Cloudinary features

| PS goal | Cloudinary does | We do |
|---|---|---|
| **1. Analyze & organize** | Upload Widget (bulk, camera, gallery); asset folders per project; `async` + `notification_url` webhooks; `quality_analysis` (focus/blur, quality score); `etag` (exact duplicates); `phash` (perceptual hash for near-duplicates); upload errors for corrupt or unsupported files | Duplicate grouping, trust checklist, review queue |
| **2. Identify activities, locations, signals** | **Cloudinary AI Vision** (Analyze API): custom tagging with the project's activities as tag definitions, plus question prompts for relevance, signals and caption (verify, §10); auto-tagging / AI Content Analysis add-ons (tags, objects, captions) (verify); `image_metadata` (EXIF, GPS, timestamp, device); structured metadata fields for project / site / activity / review status | Map the AI Vision answers to the §10 schema; vision-LLM fallback via OpenRouter only if AI Vision is unavailable |
| **3. Before / after** | Side-by-side composite via overlays (`l_…/fl_layer_apply`), labels via text overlays, `c_fill` / `g_auto` to frame both images the same way; AI Vision answers the same visual questions for each image | Pair selection, comparing the two sets of answers into visible-change categories, citations (LLM fallback, §13) |
| **4. Reports & campaign content** | `c_fill,g_auto` smart crop per social format; text overlays for campaign cards; `create_slideshow` to make a video story from images (verify); `e_preview` for video highlights (verify); `e_blur_faces` / `e_pixelate_faces` before publishing | Report text with per-claim citations |
| **5. Search** | **Visual Search** (text → image) if enabled (verify); Search API (expressions over tags, structured metadata, folders); captions and tags as searchable text | Turning natural-language queries into filters (dates, activity, site) |
| **6. Traceability** | Originals are never modified; every derived asset = `public_id` + `version` + transformation string, reproducible from its URL | Claim → asset citation table, and showing the chain in the UI |

**Video:** no separate video-understanding pipeline. We extract frames with `video/upload/so_<seconds>/<public_id>.jpg` (for example at 10%, 50% and 90% of duration) and send them through the image pipeline as child assets of the video. Video auto-tagging or transcription add-ons are stretch only, if quotas allow.

## 6.2 Where the data lives

| Cloudinary | Our DB (Neon Postgres) |
|---|---|
| Original files and derived versions | Projects, sites, activity lists |
| Tags, captions, EXIF, quality, pHash, etag, AI Vision results | Copies of those + normalized analysis JSON (§10) + embeddings (only if needed) |
| Structured metadata: `project`, `site`, `activity`, `review_status`, mirrored so the Cloudinary Media Library stays usable on its own | Status, status reason, review history (who / when / why) |
| Transformation URLs | Comparisons, reports, claims, claim → asset citations |

**Our DB is the source of truth** for status, dates and relationships. Cloudinary structured metadata is a mirror written back after processing.

## 6.3 Cautions

- **No generative transformations on evidence.** Generative fill, background replacement or restore on an evidence photo is fabrication. They are allowed only on campaign output that is clearly labelled as edited, if at all.
- **Add-on quotas are small on free plans.** The dataset size (§19) is set to fit whatever we find on day 1.
- **Keep secrets server-side.** The Cloudinary API secret is used only on the server (§15).

---

# 7. Evidence Pipeline

`[CLD]` = Cloudinary does it, `[US]` = our code.

```text
Upload Widget / capture page ....................................... [CLD]
   |  signed upload preset with: image_metadata, quality_analysis, phash,
   |  auto-tagging / detection add-ons, context (batch + capture data),
   |  asset folder = project, notification_url = our webhook
   |  (corrupt / unsupported / empty files fail here -> shown as REJECTED in UI)
   v
Webhook -> backend (verify signature) .............................. [US]
   |
   +-- 1. Store Cloudinary response (EXIF, GPS, quality, pHash, etag, tags, caption)
   +-- 2. Resolve captured_at + location (priority order in §8.3)
   +-- 3. Duplicate check: etag (exact) / pHash distance (near) -> group
   +-- 4. Video? -> create frame assets via so_ URLs -> run 1–6 on each frame
   +-- 5. Cloudinary AI Vision (fallback: vision LLM via OpenRouter)
   |       -> {caption, activity, relevant, signals, reason} .... [CLD] / [US]
   +-- 6. Trust checklist -> status (ACCEPTED / REVIEW / REJECTED) + reason
   +-- 7. Write structured metadata back to Cloudinary
   v
Evidence: searchable, reviewable, citable
```

- **No separate queue infrastructure** (no Redis/Celery). The webhook marks the asset `processing`, and a simple background worker loop (or a job triggered per webhook) runs steps 1–7.
- **Each asset shows its pipeline state in the UI** (`uploaded → analyzing → classified`), so the demo visibly shows processing.

---

# 8. Evidence Status & Trust

## 8.1 Questions the system answers for every asset

- Is the file valid and usable (not corrupt, not too blurry, not empty)?
- Is it a duplicate or near-duplicate?
- Is it relevant to the project, and which activity does it show?
- What objects, activities and visual signals are visible?
- What metadata is available, and can it be tied to a date, site and location?
- Does it need human review?

## 8.2 Statuses

AI can say whether media is **consistent with a claim**. It cannot prove media is authentic, so we never label anything "Verified".

```text
PROCESSING — pipeline still running
ACCEPTED   — all trust signals pass (auto), or approved by a reviewer
REVIEW     — at least one signal uncertain -> human review queue
REJECTED   — unusable: corrupt, too blurry, irrelevant, or duplicate (non-canonical)
```

**Trust signals, not percentages.** AI confidence numbers aren't calibrated, so the platform **shows no numeric confidence scores to users**. Code may apply internal thresholds (for example to AI Vision tag confidence), but only the resulting pass/fail appears in the UI. Each asset gets a checklist instead:

```text
✓ Sharp enough              (quality_analysis above threshold)
✓ Not a duplicate           (etag / pHash)
✓ Relevant to project       (analysis relevant_to_project)
✓ Activity in project list  (analysis activity != other)
✓ Date within project dates (captured_at)
✗ No location               -> REVIEW
```

**Status rule (deterministic, explainable in one sentence):**

- Any hard fail (corrupt, blur below the minimum, non-canonical duplicate, clearly irrelevant) → `REJECTED`
- Otherwise any soft fail (no date, no site/location, activity = other, borderline blur) → `REVIEW`
- Otherwise → `ACCEPTED`

A reviewer can move any asset to any status. Every change is logged as a `ReviewEvent`.

## 8.3 Date & location resolution

Priority order (the one used is stored as `capture_source`):

1. **Capture page:** GPS and time recorded by the browser at capture (strongest)
2. **EXIF:** from `image_metadata` (editable, and stripped by WhatsApp and many apps)
3. **User batch context:** site / date given at upload
4. **Upload time:** fallback for date only; flags the asset for REVIEW if outside project dates

EXIF and batch context are hints. Capture-page data is stronger. None of them is proof.

**Field capture page:** `<input type="file" accept="image/*" capture="environment">` plus `navigator.geolocation`. It sends GPS and time as Cloudinary `context` on upload. This replaces a native mobile app.

## 8.4 Quality checks

| Problem | Handled by |
|---|---|
| Corrupt / empty / unsupported file | Cloudinary upload error → REJECTED |
| Too blurry | `quality_analysis` focus value below threshold → REJECTED (borderline → REVIEW) |
| Very low resolution | width/height from the upload response, below minimum → REVIEW |
| Poorly usable video | extracted frames fail the blur check → REVIEW |
| Duplicate | §9 |

Thresholds get tuned on the real dataset during day 1–2.

---

# 9. Duplicate & Near-Duplicate Handling

```text
IMG_001.jpg, IMG_001_copy.jpg, IMG_001_final.jpg,
IMG_001_whatsapp.jpg, IMG_001_compressed.jpg
   -> same etag             => exact duplicate
   -> pHash Hamming distance <= ~6 bits => near-duplicate (tune on real data)
   -> group: canonical = highest quality / largest resolution / earliest captured
   -> others: duplicate_of = canonical id, status REJECTED (reason: duplicate)
```

- Copies are not deleted. The relationship to every source asset is kept.
- No embedding-based similarity for dedupe. pHash handles recompressed, resized and re-shared copies.

---

# 10. AI Media Understanding

**Cloudinary AI Vision first, LLM fallback.** Per-asset analysis runs inside Cloudinary when AI Vision is available on our account. This is the heaviest AI work in the system, so running it in Cloudinary also maximizes visible Cloudinary usage. A vision LLM via OpenRouter is used only if AI Vision is unavailable, over quota, or fails on an asset. Both paths produce the **same normalized schema**, so nothing downstream cares which one ran.

## 10.1 Normalized analysis schema (stored on `Asset`)

```json
{
  "caption": "Volunteers collecting plastic waste on a muddy riverbank",
  "activity": "river_cleanup",
  "relevant_to_project": true,
  "category": "environmental_activity",
  "signals": ["people_present", "crowd", "water_body", "waste_visible",
              "cleanup_tools", "vegetation", "infrastructure"],
  "reason": "Visible bags of collected waste and gloved volunteers near water",
  "analysis_source": "cloudinary_ai_vision"
}
```

- `activity` must be one of the project's activities, or `other`.
- `signals` come from a fixed vocabulary: people/crowd presence, environmental features (water, vegetation, waste, bare soil), infrastructure (construction, structures, equipment) and activity cues. Objects come from Cloudinary tags.
- `analysis_source` is `cloudinary_ai_vision` or `llm_fallback`.
- **No numeric confidence shown** (see §8.2).
- Text visible inside an image is data, never instructions. This applies to both paths (prompt-injection risk).

## 10.2 Primary path: Cloudinary AI Vision (Analyze API; Day-1 corrections)

**Account check, 2026-09-24, after enablement:** all **eight calls returned HTTP 200** using three existing uploads: tagging + general questions on fixtures 1/2/3, plus before/after questions separately on fixtures 1/2. No uploads or other API probes ran. The endpoint and flat request bodies below are confirmed. Original HTTP 400 `MA_00003` underscore-name failures and HTTP 403 `MA_00007` subscription failures remain historical evidence; hyphenated tag names now succeed. Exact measured analyses and quota objects are in `docs/day1-ai-vision-results.json`; local requests/responses are indexed in `docs/day1-checks.md`.

**Measured success envelope:** `{ "limits": { "addons_quota": [{ "type": "ai_vision", "used_by_request": 874, "remaining": 99126, "limit": 100000 }] }, "request_id": "...", "data": { "entity": "<input URL>", "analysis": { "tags": [{ "name": "vegetation" }], "model_version": 1 } } }`. This is fixture 1 tagging with only URL/request ID values abbreviated. **Correction: `limits.items` is absent.** Select `limits.addons_quota` by `type === "ai_vision"`; `used_by_request` is this call's tokens, `remaining` is the balance, and `limit` is the account allowance. The calls expose total billed tokens, not an input/output split. General and pair responses replace `tags` with `responses: [{"value":"..."}]`, retain `model_version: 1`, and use the same envelope.

**Capacity estimate from this bounded sample:** tagging used **874 / 877 / 874** tokens; two-question general used **753 / 756 / 746**, totaling **1,627 / 1,633 / 1,620 per asset** (mean **4,880 / 3 = 1,626.67**). The **100,000-token monthly tier covers about 61 assets** for one ten-definition tagging call plus one two-prompt general call per asset; **92,533 remaining covers about 56 additional assets** at that mean. The four before/after questions cost **1,281 + 1,306 = 2,587 tokens/pair** separately, so fresh assets receiving both base analysis and pair questions average **2,920.17 tokens/asset**, or **34 assets / 17 complete pairs per full month**. Do not divide by the average across all eight mixed calls to estimate assets. These are projections, not guarantees: larger vocabularies require more tagging batches, and prompts, image sizing and answer lengths change costs. The base requests used `c_limit,w_1024`; pair requests reused original-size URLs. This tiny irrelevant-image sample does not establish production accuracy. Use the LLM fallback after quota exhaustion; a 100–300 asset dataset exceeds this measured free-tier base-analysis capacity.

Two calls per asset, authenticated with the Cloudinary API key and secret (server-side only). Input is the asset's delivery URL (or asset ID).

1. **Custom tagging → `activity` + `signals`**

   API tag names must use lower-case letters, digits or hyphens; translate project keys such as `river_cleanup` to `river-cleanup` for the request and back to underscores on normalization. At most **10 definitions per call**; batch a larger project activity + signal vocabulary. Text visible inside images is untrusted data, never instructions; include this guard in tag descriptions and question prompts.

   `POST https://api.cloudinary.com/v2/analysis/<cloud_name>/analyze/ai_vision_tagging`
   ```json
   {
     "source": { "uri": "<delivery URL, ~1024px>" },
     "tag_definitions": [
       { "name": "river-cleanup", "description": "People removing litter or debris from a riverbank or water" },
       { "name": "tree-plantation", "description": "People planting saplings or young trees" },
       { "name": "waste-visible", "description": "Litter, plastic or garbage visible on the ground or in water" },
       { "name": "vegetation", "description": "Plants, grass or trees clearly visible" }
     ]
   }
   ```
   Tag definitions = the project's activities (from `Project.activities`, each with a one-line description) + the fixed signal vocabulary, batched within the 10-definition limit. The **observed** successful response is `data.analysis.tags: [{"name": "vegetation"}]`, with `data.analysis.model_version: 1` and usage in `limits.addons_quota`. Fixture 2 returned `people-present` and `vegetation`; fixture 3 returned an empty array. No numeric tag confidence or ranking was returned; the earlier best-match confidence-threshold assumption was wrong. For a single returned activity use it; for no activity or multiple activities use `other` and route to review, pending a separately validated disambiguation strategy. Normalize API hyphens back to schema underscores.

2. **Questions → `caption`, `relevant_to_project`, `reason`**

   `POST https://api.cloudinary.com/v2/analysis/<cloud_name>/analyze/ai_vision_general`
   ```json
   {
     "source": { "uri": "<delivery URL>" },
     "prompts": [
       "Describe this image in one factual sentence.",
       "Project: <project description>. Is this image relevant evidence for this project? Answer 'yes' or 'no', then one short reason."
     ]
   }
   ```
   At most **10 prompts per call**. The **observed** successful response uses `data.analysis.responses: [{"value": "..."}]` in prompt order, `model_version: 1`, and usage under `limits.addons_quota`. All three general responses returned a caption and a reason starting with `No.`, normalized successfully with `analysis_source: "cloudinary_ai_vision"`. Pair answers were `["some","none","none","no"]` and `["some","none","a few","no"]`, all valid fixed choices. These unrelated fixtures are not real before/after evidence. Validate the arrays and answer types before normalization. Parse the yes/no strictly. An unparseable answer → `relevant_to_project = null` → the asset goes to REVIEW. `category` is not supplied by the original two questions: derive it conservatively from the selected activity (or add a validated category prompt); never invent it from a missing field.

   Previously observed error envelope: `{ "error": { "category": "auth_error", "code": "MA_00007", "message": "account does not have an active subscription for feature", "details": { "feature_name": "ai_vision" }, "request_id": "..." } }`. On any AI Vision or quota error, preserve the raw error and use the OpenRouter fallback, recording `analysis_source = "llm_fallback"`. The enabled-account rerun did not invoke that fallback or deliberately exhaust quota.

## 10.3 Fallback path and other LLM uses: OpenRouter

An LLM is still used for **search query → filters (§12)** and **report writing (§14.2)**. It is also the fallback for §10.2 and for before/after (§13).

- **API:** OpenRouter, OpenAI-compatible Chat Completions at `https://openrouter.ai/api/v1/chat/completions`. Use the `openai` npm SDK with `baseURL: "https://openrouter.ai/api/v1"` and `apiKey: OPENROUTER_API_KEY`.
- **Models are env vars, not hardcoded:** `LLM_MODEL_VISION` (must accept images; used for fallback analysis and before/after) and `LLM_MODEL_TEXT` (used for search and reports). Pick them on day 1 by running the same 5 test images through 2–3 candidates.
- Images are sent as `image_url` content parts using the Cloudinary delivery URL (~1024px).
- Request structured JSON output where the model supports it (verify per model), and **always validate against the schema in code anyway**. Malformed output → retry once → otherwise status REVIEW.
- Free `:free` models are fine for development but rate-limited. Use a cheap paid model for the demo so it doesn't fail live.
- **If no LLM is available at all:** search falls back to keyword/date matching, and reports fall back to a template filled from DB counts and comparison results. The demo still works, just less fluently.

---

# 11. Organization, Timeline & Activities

**Organization:**

```text
River Restoration — Kolkata
  +-- Timeline      (generated view)
  +-- Activities    river_cleanup | tree_plantation | infrastructure | community_participation ...
  +-- Sites         Site A | Site B | Site C
  +-- Evidence      (all assets, filter by status / activity / site / date)
  +-- Review queue
  +-- Before / After
  +-- Search
  +-- Reports
```

**Timeline** is a generated view (group by `captured_at` day/week), not stored data:

```text
JANUARY
  15 Jan  42 photos, 3 videos   river_cleanup
  22 Jan  28 photos             waste_removal
FEBRUARY
  05 Feb  36 photos             tree_plantation
  19 Feb  51 photos             community_participation
```

**Activity breakdown** is a count of assets by activity (ACCEPTED only, with REVIEW shown separately):

```text
river_cleanup            842
tree_plantation          613
waste_removal            427
community_participation  291
```

---

# 12. Search

Users search by meaning, not filename (`IMG_8291.jpg`). Target queries:

- "Show me evidence of community participation during the river restoration campaign between January and March."
- "Find photos showing volunteers planting trees near the river."
- "Show infrastructure work completed in March."

**Design (hybrid):**

1. **Query → filters:** the text LLM (`LLM_MODEL_TEXT` via OpenRouter, §10.3) turns the query into `{text, date_from, date_to, activity?, site?}`. If no LLM is available, simple month/date and activity-keyword matching does this instead. Date filtering is done in **our DB on `captured_at`**, because Cloudinary's dates are upload dates, not capture dates.
2. **Semantic part, in order of preference:**
   - **Cloudinary Visual Search** (text → image) if enabled on our account (verify). Current docs say all images are indexed automatically after the feature is enabled on the product environment. The `visual_search` upload option is deprecated and has no effect; HTTP 200 with no hits does not establish indexing.
   - **Fallback:** embed `caption + tags + activity + signals` and store it in Neon with the pgvector extension (`CREATE EXTENSION vector;`). Use OpenRouter's embeddings endpoint if it's available (verify), otherwise another embedding provider (`EMBEDDING_API_KEY`).
3. **Combine:** intersect semantic hits with the DB filters, and show ACCEPTED assets first.

**Every result shows:** thumbnail, **why it matched** (the caption, tags or activity that hit), project, site, activity, date, status, and a link to the original Cloudinary asset.

---

# 13. Before / After

- **Pairing:** the user picks two assets, or the default is the earliest vs latest ACCEPTED asset at the same site. No automatic viewpoint matching.
- **Visual:** a Cloudinary composite built from one transformation URL, with both images side by side and date labels (verify syntax):

```text
https://res.cloudinary.com/<cloud>/image/upload/
  c_fill,w_800,h_600/c_pad,w_1600,h_600,g_west/
  l_<after_public_id_with_colons>/c_fill,w_800,h_600/fl_layer_apply,g_east/
  l_text:Arial_36_bold:BEFORE%20<date>,co_white/fl_layer_apply,g_north_west,x_20,y_20/
  l_text:Arial_36_bold:AFTER%20<date>,co_white/fl_layer_apply,g_north_east,x_20,y_20/
  <before_public_id>.jpg
```

(Overlay public IDs use `:` in place of `/` for folders.)

- **Analysis, primary path (Cloudinary AI Vision, verify):** ask `ai_vision_general` the **same fixed questions about each image separately**, for example "How much vegetation is visible: none, some or a lot?", "How much litter or waste is visible: none, some or a lot?", "How many people are visible: none, a few or many?", "Are newly planted trees or saplings visible: yes or no?". Our code compares the two sets of answers (none < some < a lot) and outputs `more` / `less` / `same` for each category. This is deterministic and explainable, and each answer is stored as evidence.
- **Fallback:** one call with both images to `LLM_MODEL_VISION` via OpenRouter (§10.3), returning the same categories.
- Either way, the output is **visible differences only**, as categories, with no numbers:

```text
VISIBLE CHANGES — Site A, January -> June
  Vegetation      more
  Tree presence   more
  Visible waste   less
  Human activity  more
Sources: before = asset_8291, after = asset_9234
```

- We never write "the river became 40% cleaner". We only claim what the pair of images visibly shows.
- **Output:** a `Comparison` record citing both asset IDs plus the composite URL.

---

# 14. Traceability, Reports & Campaign Content

## 14.1 Traceability chain (demo centerpiece)

```text
Report claim
   -> Comparison / Evidence asset
      -> Derived image (transformation URL — shows exactly what was done)
         -> Original Cloudinary asset (public_id + version, untouched)
```

Instead of *"The river became cleaner."*, the report says:

```text
Visible environmental changes detected at Site A (January -> June).
  Evidence: before asset_8291, after asset_9234 (visual comparison)
```

Every evidence card and every report sentence shows the **transformation URL** and a link to the **original**. One click proves traceability (goal 6) and Cloudinary usage together.

## 14.2 Report generation (grounded by construction)

1. Gather facts from the DB: counts by status, activity and site; date range; comparisons.
2. Feed the text LLM (`LLM_MODEL_TEXT` via OpenRouter) **only ACCEPTED evidence and comparisons**, as `{id, caption, activity, site, date}` records.
3. The LLM returns `[{ "text": "...", "sources": ["asset_…", "comparison_…"] }]`.
4. **Drop any sentence with no sources, or with IDs that weren't in the input.**
5. Save it as a `Report` with `Claim` and `ClaimSource` rows.
6. **No-LLM fallback:** build the claims from a fixed template (one sentence per comparison category change and per activity count), with the sources attached directly. Same tables, same UI.

**Report contents:**

- Project overview: period, organization, sites
- Evidence statistics: media analyzed, accepted / review / rejected counts, duplicates removed. These are plain DB counts, so they are safe to state as numbers.
- Timeline and activity breakdown
- Before/after comparisons (composites + visible changes)
- Key observations (cited claims)
- Map of sites, only if GPS data exists
- Supporting media thumbnails with source links
- Review status breakdown

Example summary:

```text
RIVER RESTORATION — KOLKATA   (January — June 2026)
Media analyzed: 2,482   Accepted: 1,904   Review: 311   Rejected: 267
Activities: river cleanup, waste removal, tree plantation, community participation
Observed visual changes (matched sites):
  • More vegetation at Site A and Site C         [asset_8291 → asset_9234]
  • Less visible waste at Site B                 [asset_1120 → asset_7788]
  • New plantation areas documented              [asset_5521, asset_5530]
```

**Output formats:** a web report page, a project dashboard, and PDF via the browser's print-to-PDF (no PDF library).

## 14.3 Campaign-ready content (downstream of evidence only)

```text
Accepted evidence -> Report claims -> Campaign content
```

- **Social cards:** `e_blur_faces/c_fill,g_auto,w_1080,h_1080/l_text:…` in 1:1, 9:16 and 16:9, with a short caption taken from a cited claim
- **Video story:** `create_slideshow` from selected evidence (verify)
- **Web story:** the report page itself, with a shareable link
- **Face blurring is on by default** for anything leaving the platform. Community programs involve people, including children, so consent matters.
- Campaign text may only reuse cited claims. No new facts at this stage.

---

# 15. System Architecture

```text
                    USER (browser: desktop or phone)
                               |
              Next.js app (UI + API routes, one deploy)
         /            |               |                \
  Cloudinary      Neon             OpenRouter      (Embedding API,
  Upload Widget   (Postgres)       text LLM:        only if Visual Search
  Upload/Admin/   + pgvector       search, reports  is unavailable)
  Search APIs     (if needed)      vision LLM:
  AI Vision                        fallback only
  (Analyze API)
  Transformations
        |
  notification_url webhook -> /api/cloudinary/webhook -> pipeline worker (§7)
```

**Stack:** Next.js (frontend + API routes, Vercel), Neon serverless Postgres (`@neondatabase/serverless` driver, plain SQL migrations, no ORM), Cloudinary Node SDK (plus direct HTTPS calls for the Analyze API), `openai` npm SDK pointed at OpenRouter.

**Environment variables:** `CLOUDINARY_URL`, `OPENROUTER_API_KEY`, `LLM_MODEL_TEXT`, `LLM_MODEL_VISION`, `DATABASE_URL` (Neon pooled connection string), `APP_BASE_URL`, `EMBEDDING_API_KEY` (only if embeddings aren't available via OpenRouter and Visual Search is unavailable).

**Security:**

- Keep the Cloudinary API secret and `OPENROUTER_API_KEY` server-side only. AI Vision and LLM calls happen only in API routes or the pipeline worker, never in the browser. The Upload Widget uses **signed uploads** (signature from `/api/upload-signature`), and the signed preset holds the analysis flags.
- Verify webhook signatures (`X-Cld-Signature` / `X-Cld-Timestamp`; the SDK's `verifyNotificationSignature`, verify).
- No auth or multi-tenancy (single demo org), but no public write endpoints other than signed upload.
- Face blur on anything exported (§14.3).

**Upload preset / upload options (starting point):**

```js
{
  asset_folder: `ps02/${projectId}`,
  image_metadata: true,          // EXIF, GPS, timestamp (newer SDKs: media_metadata)
  quality_analysis: true,        // focus / quality score
  phash: true,                   // perceptual hash
  categorization: "google_tagging", auto_tagging: 0.6,   // add-on, if enabled (verify)
  detection: "captioning",       // AI Content Analysis add-on (verify)
  visual_search: true,           // Day-1 compatibility probe only; deprecated, no indexing effect
  context: { site, activity_hint, captured_at, lat, lng, capture_source },
  notification_url: `${APP_BASE_URL}/api/cloudinary/webhook`,
}
```

Some add-on results arrive asynchronously through the webhook. The pipeline must handle a result arriving after the upload response.

**Structured metadata fields (created once via the Admin API):** `project` (string), `site` (string), `activity` (enum), `review_status` (enum: processing / accepted / review / rejected).

**API routes:**

| Route | Purpose |
|---|---|
| `POST /api/projects`, `GET /api/projects/:id` | Create / load project (with sites, activities, stats) |
| `POST /api/projects/:id/sites` | Add site |
| `POST /api/upload-signature` | Sign Upload Widget params |
| `POST /api/cloudinary/webhook` | Receive upload / add-on results, start pipeline |
| `GET /api/projects/:id/assets?status&activity&site&from&to` | Evidence list, timeline, activity counts |
| `GET /api/assets/:id` | Evidence detail (analysis, checklist, trace chain) |
| `POST /api/assets/:id/review` | Change status, write `ReviewEvent` |
| `GET /api/projects/:id/search?q=` | Hybrid search (§12) |
| `POST /api/comparisons` | Create before/after (§13) |
| `POST /api/projects/:id/reports`, `GET /api/reports/:id` | Generate / view report (§14.2) |

Campaign cards are built client-side as Cloudinary URLs, so they need no endpoint.

**Pages:** project dashboard (overview, timeline, activity counts, status breakdown) · upload · capture (phone) · evidence list · evidence detail · review queue · search · before/after · report.

---

# 16. Data Model

```text
Project     id, name, organization, campaign_type, location,
            start_date, end_date, description, activities[]

Site        id, project_id, name, lat?, lng?

Asset       id, project_id, site_id?,
            cloudinary_public_id, version, resource_type (image | video),
            parent_asset_id?,            -- video frames point to their video
            width, height, bytes, format,
            captured_at?, capture_source (capture_page | exif | user | upload_time),
            lat?, lng?, exif (json),
            quality_score?, etag, phash, duplicate_of?,   -- canonical asset of dupe group
            cld_tags[], cld_caption?,
            caption, activity, category, relevant, signals[], reason,
            analysis_source (cloudinary_ai_vision | llm_fallback),
            ai_vision_raw (json),        -- raw Analyze API answers, kept as evidence
            checklist (json),            -- trust signals §8.2
            pipeline_state (uploaded | analyzing | classified | failed),
            status (processing | accepted | review | rejected), status_reason,
            embedding?,                  -- only if Visual Search unavailable
            created_at

ReviewEvent id, asset_id, reviewer, from_status, to_status, note, created_at

Comparison  id, project_id, site_id, before_asset_id, after_asset_id,
            composite_url, changes (json),
            answers (json),              -- per-image AI Vision answers the changes were derived from
            analysis_source, created_at

Report      id, project_id, period_start, period_end, stats (json), created_at

Claim       id, report_id, text, position

ClaimSource claim_id, asset_id?, comparison_id?, derived_url?
```

Design notes:

- AI analysis lives on `Asset` because it is 1:1 with the asset.
- `Claim` + `ClaimSource` give sentence-level citations, which is what makes traceability real.
- `ReviewEvent` records who changed a status, when and why, which is part of provenance.
- The timeline and activity counts are queries, not tables.

---

# 17. Scope

## MVP spine (must work end to end)

```text
Create project -> Bulk upload -> Cloudinary analysis + AI Vision -> Status + review queue
   -> Evidence viewer (with trace chain) -> Timeline + activity counts
   -> Search -> Before/after (one site) -> Cited report
```

## Stretch (in order, only once the spine works)

1. Campaign cards (face blur + smart crop + text)
2. Field capture page (move into the MVP if the dataset uses it, §19)
3. Video frame extraction
4. `create_slideshow` video story
5. Evidence quality analytics (rejection reasons, dupes removed): a cheap dashboard panel
6. Interactive timeline polish
7. Map view (only if the dataset has GPS)
8. Video tagging / transcription add-ons

## Cut (explicitly not building)

- Native mobile app (the capture page replaces it)
- Our own CDN, storage, DAM features or computer-vision models
- Processing-queue infrastructure (Redis/Celery)
- Separate vector database
- Automatic project/activity discovery (activities are configured per project)
- Intelligent clustering beyond duplicate grouping
- Video segment understanding
- Numeric confidence scores shown to users
- Auth / multi-tenant / NGO management features
- Generic chatbot, and unrelated AI features

---

# 18. Build Plan

## Day-1 checks (first ~2 hours, both people)

1. In the Cloudinary account: which add-ons can we enable, and what are their free quotas (auto-tagging, AI Content Analysis captioning, **AI Vision / Analyze API**)?
2. Is Visual Search available? Test one text query.
3. Upload 10 test images with all flags on and read the response. Does it include EXIF, GPS, quality, pHash, etag, tags and caption?
4. **AI Vision:** run the §10.2 tagging and question calls on 5 test images (including an irrelevant one), then run the §13 before/after questions on one pair. Record the exact request/response shapes and fix §10.2 if they differ. **This decides the primary vs fallback path.**
5. **OpenRouter:** run the same 5 images through 2–3 candidate vision models, plus one query → filters test on a text model. Set `LLM_MODEL_VISION` / `LLM_MODEL_TEXT`.
6. Test the before/after composite URL (§13).
7. Confirm the judging rubric and time budget, then adjust §17.

## Team split

| Person A — Ingest & Intelligence | Person B — Product & Output |
|---|---|
| Signed upload preset, webhook, DB writes | Project, upload and evidence UI |
| Date/location resolution, dupe grouping | Timeline, activity counts, dashboard |
| Trust checklist + status rules | Review queue |
| AI Vision analysis (+ LLM fallback), query → filters, report generation | Search UI, before/after page, report page |
| Structured metadata sync to Cloudinary | Campaign cards, capture page, demo polish |

## Order of work

1. Day-1 checks
2. Upload → webhook → DB, with raw Cloudinary data visible in the UI
3. AI Vision analysis (LLM fallback) + status rules + review queue
4. Evidence viewer with trace chain, timeline, activity counts
5. Search
6. Before/after
7. Cited report
8. Stretch items
9. Polish (below)

## Polish checklist

- Loading and pipeline-state indicators ("Analyzing… Classifying… Detecting duplicates…")
- Error states (failed upload, AI Vision/LLM failure → REVIEW)
- Clear AI explanations (checklist, "why matched", analysis `reason`, and a "Analyzed by Cloudinary AI Vision" label)
- Trace chain visible on every evidence card and report claim
- Fast demo path: pre-ingested data, and no step that waits more than a few seconds
- Judge-facing demo script rehearsed (§19)

---

# 19. Demo Dataset & Story

## Dataset (#1 risk: source it first)

Before/after needs **the same site, from a similar angle, on different dates**. Stock photos can't provide that.

- **Our own before/after pairs:** pick 2–3 real spots (a littered patch, a bare plot), photograph them, clean up or plant, and photograph again from the same position. Use the capture page so GPS and time are genuine.
- **Bulk activity photos:** openly licensed images (Wikimedia Commons, Unsplash) for cleanup, plantation, infrastructure and community events. Record the license for each.
- **Planted problems:** WhatsApp-recompressed copies (duplicates), a few blurry shots, a few irrelevant images, one corrupt file. These make the pipeline visibly do something.
- **Size:** whatever fits the add-on quotas (likely 100–300 assets). The story describes a campaign of thousands, while the demo runs on a representative slice.

## Demo story

Start with the problem, not the tech.

**Scenario:** a sustainability organization is restoring a river. Over six months: 2,000+ photos, 100+ videos, multiple sites, multiple field teams and multiple activities. Which of it proves impact?

1. **Project:** "River Restoration — Kolkata", already created, with pre-ingested data.
2. **Live upload:** 5–10 files, including a duplicate, a blurry photo and an irrelevant image. Show the pipeline states, then the files landing in REJECTED/REVIEW with reasons.
3. **Review queue:** approve one item and show its `ReviewEvent`.
4. **Timeline + activities:** the campaign evolving over time.
5. **Search:** *"community participation between February and April"* → results with a "why matched" note on each.
6. **Evidence detail:** activity, site, date, AI caption and reason, trust checklist, transformation URL, original asset.
7. **Before/after:** one site, a Cloudinary composite and the listed visible changes.
8. **Report:** click a sentence → cited asset → transformation URL → original.
9. **Campaign card:** one click, with faces blurred.

> **Raw media → trusted evidence → intelligence → impact story**, and every step visibly runs on Cloudinary.

---

# 20. Decisions Log (formerly open questions)

| # | Question | Decision |
|---|---|---|
| 1 | Which Cloudinary features? | §6.1 and §15 |
| 2 | Which AI capabilities are available? | Day-1 check (§18) |
| 3 | Limits / pricing? | Day-1 check; the dataset is sized to the quotas |
| 4 | Bulk upload? | Cloudinary Upload Widget, signed, direct from the browser |
| 5 | Mobile / field upload? | Responsive capture page, no native app |
| 6 | EXIF / GPS extraction and trust? | `image_metadata`; priority order in §8.3; hints, not proof |
| 7 | Duplicates? | `etag` (exact) + pHash Hamming distance (near), canonical per group |
| 8 | Reasoning model? | Per-asset analysis and before/after: Cloudinary AI Vision first. LLM via OpenRouter (models in env vars, chosen on day 1) for search, reports and as the fallback (§10) |
| 9 | Vector DB? | No separate one. Cloudinary Visual Search first, pgvector on Neon as fallback |
| 10 | Where are embeddings generated? | Only if needed: embedding API on caption + tags, stored in pgvector |
| 11 | Semantic search? | Hybrid: LLM query → filters (DB) + semantic hits (§12) |
| 12 | Before/after matching? | User picks, or earliest vs latest ACCEPTED per site |
| 13 | Evidence confidence? | Rule-based trust checklist, no percentages shown to users |
| 14 | Human review? | REVIEW queue + `ReviewEvent` log |
| 15 | Unsupported AI claims? | Citation-required generation; uncited sentences dropped |
| 16 | Cloudinary vs our DB? | §6.2 |
| 17 | MVP for 2 people? | §17 spine |
| 18 | Strongest demo? | §19 |

**Still open:** hackathon duration, judging rubric, and the results of the Cloudinary quota / Visual Search / AI Vision checks and the OpenRouter model choice (§4).
