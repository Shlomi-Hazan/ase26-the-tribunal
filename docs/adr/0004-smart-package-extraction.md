# ADR 0004 — Smart Tribunal Package Extraction (Milestone 7A)

## Status

Proposed (planning/specification gate). Locks the architectural
decisions needed before M7A implementation begins. Does **not**
authorize implementation, dependency installation, a database
migration, or any real OpenRouter model request. Written on branch
`milestone/07a-smart-package-extraction`, base `main` at
`926ba66cace83347a1a3f27f46921819213dd6b5` (the M7 merge commit).

## Context

Milestone 7 (merged, PR #12) built the OpenRouter provider boundary,
route resolution, decimal-safe economics, and a standalone preflight
service — the infrastructure a real model call needs to be resolved,
priced, and bounded before it happens. Milestone 8 will use that
infrastructure to execute the seven-call Tribunal for the first time.

M7A sits between them. Its product goal (already recorded, unresolved
in detail, in `ROADMAP.md`, `SPEC.md` §19, `ARCHITECTURE.md` §19,
`SECURITY.md`, and `docs/economics.md` §22): let a user provide a
generic, free-form Tribunal dossier — pasted text, `.txt`, `.md`, or a
text-extractable `.pdf` — and turn it into the same normalized
`TribunalSetupDraft` the M5 deterministic marker-based package import
already produces (`src/schemas/tribunalSetup.ts`,
`netlify/server/importParsers.ts`). Unlike M5's import, M7A's input is
**not** structured with `[SECTION]`/`FIELD:` markers — it is arbitrary
prose — so a deterministic parser cannot reliably fill the seats. M7A
adds exactly **one** setup-time structured-extraction model call to do
that mapping, under strict schema validation, with mandatory human
review before any of it can be used to convene a Tribunal.

This ADR converts that roadmap-level idea into an implementation-ready
contract, consistent with everything M5/M6/M7 already established. It
resolves the items every prior planning document explicitly deferred:
the exact PDF extraction approach, the extraction economics ceiling,
the exact structured-output schema, the ambiguity/null policy, the
retry/timeout design under real serverless Function limits, the
persistence boundary, and the API/UI contracts.

## Precedence and conflict check

Reviewed in order: `INTENT.md`, `SPEC.md` §19/§20, `ARCHITECTURE.md`
§19, `SECURITY.md` §9–10, `AGENTS.md`, `CLAUDE.md`, `ROADMAP.md`'s M7A
section, `docs/ui-spec.md` §5/Review, `docs/economics.md` §22,
`docs/adr/0003-openrouter-infrastructure.md`, the M5 import
implementation (`netlify/server/importParsers.ts`,
`src/schemas/tribunalSetup.ts`), the M6 freeze contract
(`netlify/server/runs.ts`), and M7's provider/pricing/preflight
infrastructure and its verification evidence.

**No material conflict was found.** Every document that mentions M7A
describes the same flow, the same fixed-seat target, and the same
non-goals; where a document left a decision explicitly open (PDF
library, extraction ceiling, retry semantics, persistence), the others
were silent rather than contradictory. This ADR resolves those open
items; it does not need to arbitrate between disagreeing sources.

## Decision 1 — Preserve the existing scope and non-goals verbatim

`ROADMAP.md`'s M7A Goal/Scope/Explicit-non-goals section and `SPEC.md`
§19's flow/constraints are preserved as written and are the outer
boundary for every decision below. In particular, unchanged:

- Input: pasted free-form text, `.txt`, `.md`, text-extractable `.pdf`.
- Output target: the same normalized `TribunalSetupDraft` used by M5.
- Exactly the seven fixed seats: `PRO_1`, `PRO_2`, `CON_1`, `CON_2`,
  `JUDGE_1`, `JUDGE_2`, `JUDGE_3` — no arbitrary participant creation,
  no role/side changes, no eighth participant.
- No model assignment import; no automatic Tribunal execution.
- No OCR unless separately approved (not approved by this ADR).
- The extraction call is not one of the seven Tribunal logical calls.
- No hard-coded lecturer/course dossier as product configuration.

## Decision 2 — Locked product flow

```text
Upload / paste free-form dossier
  -> deterministic validation (type, size, decode)
  -> deterministic text extraction (decode / PDF text layer)
  -> ONE setup-time structured extraction model call
  -> strict schema validation (server-side, before trust)
  -> deterministic seat mapping (fixed lookup table, no heuristics)
  -> Extraction Review (staged preview, NOT the active draft yet)
  -> human edits / corrections
  -> explicit "Apply extracted draft" -> existing setup Review
  -> existing normal setup validation (tribunalSetupDraftSchema, unchanged)
  -> explicit Convene later (unchanged M5/M6 behavior)
```

The extraction action itself never creates a run, invokes an advocate
or judge, produces a verdict, or creates an eighth participant. Every
step from "Extraction Review" onward reuses M5/M6's existing Review
screen and validation unmodified — M7A only ever produces a candidate
`TribunalSetupDraft`, staged for review, never a persisted case or run.

## Decision 3 — Input contract

One authoritative bound applies uniformly to the **normalized dossier
text**, regardless of source:

```ts
export const NORMALIZED_DOSSIER_TEXT_MAX_CHARS = 40_000;
```

Chosen as a generous multiple of the theoretical maximum normalized
`TribunalSetupDraft` content (`200 + 6000 + 1000 + 7×(120+4000) ≈
36,040` characters if a dossier were already perfectly minimal) — free
prose needs headroom beyond that sum, but the bound must still be
finite and priced (Decision 9).

Per-source rules (mirroring `netlify/server/importParsers.ts`'s
existing `assertFile`/`sanitizeFilename` pattern — reused, not
reinvented):

| Source | Raw limit | Decode/extract policy |
|---|---|---|
| Pasted text | `NORMALIZED_DOSSIER_TEXT_MAX_CHARS` directly (no raw/normalized gap) | trimmed, `\r\n?`→`\n` normalized |
| `.txt` / `.md` | 256 KiB raw bytes | `TextDecoder("utf-8", {fatal:true})`, same fatal-decode-error policy as M5 |
| `.pdf` | 8 MiB raw bytes | text-layer extraction only (Decision 4); the **extracted** text is still bound by `NORMALIZED_DOSSIER_TEXT_MAX_CHARS` |

Filename policy: reuse `sanitizeFilename` unchanged, extended with
`.pdf` in `allowedTextExtensions`'s sibling PDF check (extension
allowlist, path-separator/null-byte/`.`/`..` rejection, 255-char cap).

Empty-content behavior: decoded/extracted text that is empty or
whitespace-only after trim is a hard failure (`NORMALIZED_TEXT_EMPTY`),
never silently proceeds to the model call. A **non-empty but sparse**
dossier is **not** separately hard-blocked by a heuristic minimum-length
check — it proceeds to extraction, where the ambiguity/null policy
(Decision 6) naturally produces `MISSING_FIELD` warnings for whatever
the model cannot find. This avoids inventing an arbitrary length
threshold; the review flow is the correct place to catch
under-specified input, not a second heuristic gate.

Text exceeding `NORMALIZED_DOSSIER_TEXT_MAX_CHARS` after normalization
is a hard failure (`INPUT_TOO_LARGE_FOR_MODEL`) — **never truncated**.
Silent truncation could cut off exactly the Charge Sheet content the
extraction is meant to find.

Raw-file retention: matches existing project policy exactly
(`SECURITY.md` §9) — raw bytes are transient, discarded after
normalization, never stored. Decision 13 additionally locks that the
**normalized dossier text itself** is also not persisted.

OCR: explicitly out of scope. A scanned/image-only PDF (near-zero
extractable text) fails safely with `PDF_TEXT_UNAVAILABLE` and an
actionable message ("This PDF appears to be scanned or image-based;
only text-based PDFs are supported").

## Decision 4 — PDF extraction: `pdfjs-dist`, server-only, text-layer only

**Recommended, not installed.** `pdfjs-dist` (Mozilla's PDF.js,
Apache-2.0, the library behind Firefox's built-in PDF viewer) via its
`legacy` Node-compatible entry point
(`pdfjs-dist/legacy/build/pdf.mjs`), calling `getTextContent()` per
page — no rendering, no canvas, no `node-canvas` native dependency, no
image processing.

Rejected alternatives:
- **`pdf-parse`** — a thin wrapper around an older pdf.js build with
  a thinner maintenance surface than depending on `pdfjs-dist`
  directly; no benefit over the direct dependency for this use case.
- **Browser-side extraction** — would pull a PDF-parsing library and
  raw file bytes into the client bundle and break M7's established
  "all model-adjacent processing stays server-side" boundary
  (`AGENTS.md`) for no product benefit — the extraction call itself
  must already be server-side (secret boundary), so keeping PDF
  parsing server-side alongside it is the simpler, more consistent
  design.
- **Cloud document parser / external file-processing service** — no
  existing architecture requirement demands one; `pdfjs-dist` is
  sufficient for text-extractable PDFs, which is the entire M7A PDF
  scope.
- **OCR package** — explicitly out of scope (Decision 1).

Known limitation, accepted: PDF text-layer order can be visually
non-linear (multi-column layouts, tables) — `getTextContent()` returns
text items in the order the PDF's content stream defines them, which
does not always match reading order. This is a large part of *why* a
structured-extraction model call (rather than pure deterministic
parsing) is justified here (`INTENT.md` §4.1: "AI only where cognition
is needed") — the model, not deterministic code, is expected to make
sense of possibly-reordered prose; the ambiguity/null policy (Decision
6) is the fallback when it cannot.

Malformed/encrypted PDF handling: `pdfjs-dist` throws typed exceptions
(e.g. `PasswordException`, `InvalidPDFException`) for encrypted or
structurally invalid files — caught and normalized to
`PDF_ENCRYPTED_OR_INVALID`. A recommended page-count guard (e.g. 200
pages) and a bounded extraction wall-clock timeout, independent of the
model-call timeout, are locked as required safeguards; the exact
numeric page-count ceiling is an implementation-time tuning detail, not
a planning blocker, since the `NORMALIZED_DOSSIER_TEXT_MAX_CHARS` cap
already bounds the worst case downstream.

## Decision 5 — Structured extraction schema: direct fixed-seat fields

Between (A) the model directly filling the existing fixed-seat keys and
(B) a separate canonical object requiring further deterministic
mapping: **(A)**. The model's JSON keys are exactly the existing
`PackageSeat` union (`src/schemas/tribunalSetup.ts`:
`PRO_1`/`PRO_2`/`CON_1`/`CON_2`/`JUDGE_1`/`JUDGE_2`/`JUDGE_3`) already
used by the M5 package-import contract. This is the smaller-ambiguity
choice precisely because it introduces **zero new mapping logic** — the
deterministic step from model output to `ParticipantId` is the
already-existing, already-tested `packageSeatToParticipantId` lookup,
not a new heuristic.

```ts
// src/prompts/package-extraction-schema.ts (new, planned — not created
// in this task)
const chargeSheetExtractionSchema = z.object({
  defendant: z.string().trim().max(200).nullable(),
  act: z.string().trim().max(6000).nullable(),
  exactQuestion: z.string().trim().max(1000).nullable()
}).strict();

const participantExtractionSchema = z.object({
  profileName: z.string().trim().max(120).nullable(),
  personality: z.string().trim().max(4000).nullable()
}).strict();

const extractionWarningSchema = z.object({
  code: z.enum([
    "MISSING_FIELD",
    "AMBIGUOUS_FIELD",
    "AMBIGUOUS_PARTICIPANT_MAPPING",
    "UNSUPPORTED_CONTENT_IGNORED",
    "LOW_CONFIDENCE_EXTRACTION"
  ]),
  field: z.string().trim().max(80).nullable() // e.g. "chargeSheet.defendant", "participants.JUDGE_2.personality", or null for document-wide
}).strict();

export const packageExtractionSchema = z.object({
  chargeSheet: chargeSheetExtractionSchema,
  participants: z.object({
    PRO_1: participantExtractionSchema,
    PRO_2: participantExtractionSchema,
    CON_1: participantExtractionSchema,
    CON_2: participantExtractionSchema,
    JUDGE_1: participantExtractionSchema,
    JUDGE_2: participantExtractionSchema,
    JUDGE_3: participantExtractionSchema
  }).strict(),
  warnings: z.array(extractionWarningSchema).max(40)
}).strict();
```

Every numeric bound (`200`/`6000`/`1000`/`120`/`4000`) is the **exact
same constant** already exported from `src/schemas/tribunalSetup.ts` —
the model's own output can never itself violate the schema it will
later be re-validated against. The paired JSON Schema (sent as
`response_format.json_schema`, mirroring `src/prompts/schemas.ts`'s
existing `advocateSpeechJsonSchema`/`judgeVerdictJsonSchema` pattern
exactly) uses `additionalProperties: false` at every level. No `side`,
`role`, `seatId`, model assignment, prompt version, execution mode,
provider endpoint, pricing, or run status field exists anywhere in this
schema — they are structurally absent, not merely instructed away.

## Decision 6 — Ambiguity / null policy and warning taxonomy

The extraction model must never fabricate a value it cannot support
from the dossier text. Locked mapping:

| Situation | Field value | Warning |
|---|---|---|
| Clearly supported value found | the extracted value | none |
| No supporting text found | `null` | `MISSING_FIELD` |
| Multiple conflicting plausible values | `null` | `AMBIGUOUS_FIELD` |
| Uncertain which dossier section maps to which seat | `null` on the affected seat(s) | `AMBIGUOUS_PARTICIPANT_MAPPING` |
| Dossier content the schema has no field for (e.g. an attempted model/execution assignment) | ignored, never mapped | `UNSUPPORTED_CONTENT_IGNORED` |
| Value present but the model is not confident it is correct | the extracted value, kept | `LOW_CONFIDENCE_EXTRACTION` |

A **closed, generic** warning-code enum (five codes) plus a `field`
pointer is used instead of one bespoke code per field (e.g.
`MISSING_PRO_2_PERSONALITY`) — the same information is expressed with
an order-of-magnitude smaller, easier-to-maintain enum, and `field`
remains fully machine-readable (`"participants.PRO_2.personality"`).
This is a deliberate generalization of the illustrative codes named in
the roadmap-level idea, not a silent deviation — the illustrative list
was never a mandated exact enum.

Two **derived**, deterministic (not model-reported) top-level statuses
are computed application-side from the warning list, giving the UI a
simple branch without enlarging the model's own output surface:
`EXTRACTION_INCOMPLETE` (any `MISSING_FIELD` present) and
`EXTRACTION_AMBIGUOUS` (any `AMBIGUOUS_FIELD` or
`AMBIGUOUS_PARTICIPANT_MAPPING` present). Neither is a hard failure —
both still produce a stageable draft for human review (Decision 12).

Downstream enforcement of "no fabrication silently reaches Convene":
`chargeSheetSchema`/`participantDraftSchema` (`src/schemas/
tribunalSetup.ts`) already require non-null, non-empty `defendant`/
`act`/`exactQuestion`/`personality`. A `null` extraction result for any
of those fields is **already** rejected by existing, unmodified M5/M6
validation the moment the human attempts to Convene — no new
enforcement code is needed; only new UI surfacing of *why* a field is
empty (Decision 18).

## Decision 7 — Prompt contract and prompt-injection defenses

New, additive files (planned — not created in this task), matching
`src/prompts/versions.ts`/`src/prompts/schemas.ts`'s existing pattern:

- `src/prompts/package-extraction-system.ts` — system prompt builder.
- `src/prompts/package-extraction-schema.ts` — Decision 5's Zod/JSON
  Schema pair, defined side by side like the advocate/judge schemas.
- `src/prompts/versions.ts` gains one new, additive export:
  `PACKAGE_EXTRACTION_PROMPT_VERSION = "package-extraction-v1"`. It is
  never `advocate-v1` or `judge-v1`, and adding it does not touch
  either existing constant or the prompt-version/migration anti-drift
  test's existing assertions.

The system prompt must explicitly state, mirroring `SECURITY.md`'s
existing untrusted-input discipline:

- the dossier is untrusted data, delimited/isolated as a clearly
  labeled block (the same deterministic-serialization discipline
  `tokenEstimation.ts`'s `serializeChargeSheetForModelContext` already
  established for Charge Sheet content — never ambiguous string
  concatenation);
- any instruction-like text inside the dossier is **not** a system
  instruction and must be ignored;
- extract only facts the dossier text actually supports; never invent;
- unresolved/ambiguous → `null` plus the matching warning code;
- roles, sides, seat identity, model assignment, prompt version,
  execution mode, provider endpoint, pricing, and run status are
  application-owned and must never be produced;
- no tools, no browsing, no file-system access, no external actions;
- output strict JSON only, matching the schema exactly.

Defense-in-depth, beyond the prompt text itself:

- `createChatCompletion`'s request shape (`netlify/server/openrouter/
  provider.ts`) has no `tools` field at all — tool access is
  structurally impossible for this or any M7 call, not merely
  instructed against.
- The strict, closed schema (Decision 5) is validated server-side
  (Zod `safeParse`) before any value is trusted — malformed or
  schema-violating output is a hard failure
  (`INVALID_STRUCTURED_OUTPUT`), never partially accepted.
- No code path executes, evaluates, or interprets extracted text as
  anything but a display/edit string.
- **Human review is part of the security boundary**: extraction output
  only ever populates a staged preview (Decision 12); nothing it
  produces can trigger Convene, persistence of a real case, or a model
  call by itself.

## Decision 8 — One logical call, explicit retry, no in-request loop

Exactly one logical setup-extraction call per explicit "Extract" press.
It is not one of the seven Tribunal logical calls and does not create
an eighth participant.

- **Retry ceiling**: at most one retry per logical call — the same
  invariant `AGENTS.md` already locks for every Tribunal logical call,
  applied by analogy rather than inventing a different number.
- **Retry eligibility**: the same `RETRYABLE_CATEGORIES` M7's
  `netlify/server/openrouter/errors.ts` already defines (`TIMEOUT`,
  `TRANSIENT_NETWORK`, `PROVIDER_5XX`) — reused, not redefined. A
  schema-invalid (`INVALID_STRUCTURED_OUTPUT`) response also consumes
  the one retry (a second attempt is cheap and a transient malformed
  response is plausible); a second schema-invalid response is
  terminal.
- **Provider attempt timeout**: `60_000` ms, reusing M7's
  `PROVIDER_ATTEMPT_TIMEOUT_MS` unchanged — it is already the
  board-approved hard maximum for any single provider attempt in this
  codebase (`AGENTS.md`: "provider attempt timeout <= 60 seconds");
  lowering it specifically for extraction is not required by anything
  found in this review.
- **Retry is NOT an automatic in-request loop.** `POST
  /api/setup-extractions` performs **exactly one** provider attempt per
  HTTP request. If that attempt fails with a retryable reason, the
  response tells the client so; the client must press an explicit
  "Retry" action to make the second attempt as a **separate** HTTP
  request carrying the same `extractionRequestId` (Decision 15). This
  is a structural choice, not merely a numeric one: it guarantees no
  single Function invocation ever needs to complete more than one
  60-second provider attempt, which is the safe design regardless of
  the exact current Netlify synchronous-Function execution ceiling
  (Decision 20 flags verifying that exact number as an
  implementation-time task, not a planning blocker — the architecture
  does not depend on knowing it precisely).
- A user editing the dossier and pressing "Extract" fresh, or
  explicitly choosing to extract again after a completed attempt,
  starts a **new** logical call (new `extractionRequestId`, a new,
  separately billable attempt) — never confused with a retry of the
  same call (Decision 15).

## Decision 9 — Extraction economics: a dedicated, justified ceiling

The `$5.00` Tribunal hard ceiling is per complete seven-call run and
must not be redefined or silently absorb this call
(`docs/economics.md` §22, `AGENTS.md`). A **separate, explicit,
smaller** ceiling is locked for extraction:

```ts
export const EXTRACTION_HARD_CEILING_USD = new Decimal("0.50");
```

This is not an arbitrary new number — it is a deliberate reuse of the
**existing** `BUDGET` tier's upper bound (`docs/adr/
0003-openrouter-infrastructure.md` Decision 12,
`TIER_THRESHOLDS_USD`), which has the effect of restricting extraction
to `FREE`- or `BUDGET`-tier routes only: any route whose conservative
cost estimate would exceed it is already `PREMIUM`/`ABOVE_PREMIUM`/
`HARD_BLOCK` and is correctly ineligible for a setup-time convenience
call, matching `INTENT.md` §10/§11's "prefer free/very-low-cost models,
design target substantially below the ceiling" language directly.

Worked justification (worst-case, not average-case, matching M7's own
`worstCaseAdvocateInputTokens()` philosophy exactly — assume the
3-byte-UTF-8 conservative character, assume the full output cap is
consumed):

- Worst-case input: `NORMALIZED_DOSSIER_TEXT_MAX_CHARS` (40,000) × 3
  bytes/char + prompt/schema overhead ≈ 120,000+ bytes ÷ 2 (M7's
  `ceil(bytes/2)` conservative-token proxy) ≈ 60,000+ conservative
  input tokens.
- Output cap (Decision 11): 12,000 tokens.
- At a representative `BUDGET`-tier upper rate (≈$1/M prompt, ≈$2/M
  completion): `60,000 × $1e-6 + 12,000 × $2e-6 ≈ $0.084` per attempt.
- ×2 retry reserve × 1.10 safety factor (both reused unchanged from
  M7's `economicsConstants.ts`) ≈ **$0.185** — comfortably inside the
  $0.50 ceiling with margin, even at the true worst-case input size, on
  the most expensive route tier extraction is still eligible for.

Locked policy, otherwise mirroring M7's preflight exactly:

- Decimal arithmetic throughout (`decimal.js`, no new library).
- A conservative preflight check runs **before** the model call, using
  the same worst-case-input + full-output-cap formula as the seven-call
  preflight (Decision 11's `EXTRACTION_OUTPUT_CAP_TOKENS`), against
  `EXTRACTION_HARD_CEILING_USD` rather than `$5.00`. Insufficient
  remaining budget blocks with `BLOCKED_BUDGET` before any spend.
- The retry reserve (×2) is checked at preflight time even though a
  retry is now a separate HTTP request (Decision 8) — the user is never
  let into an attempt whose *possible* retry would exceed the ceiling.
- Exact endpoint pinning reuses M7's `executionRequest.ts` mechanism
  unchanged (`provider.order`/`provider.only`, `allow_fallbacks:
  false`).
- No silent paid fallback: an ineligible/unpriced configured extraction
  model blocks with a clear reason code, never silently substitutes.
- Metadata freshness reuses M7's `ModelMetadataCache` unchanged.
  Extraction needs only **one** model's endpoint entry (not a
  catalog-wide sweep), so the smaller default
  `MODEL_METADATA_CACHE_MAX_ENTRIES` (200) is already sufficient — the
  larger `ENDPOINT_METADATA_CACHE_MAX_ENTRIES` (1024) discovery bound
  is not needed here.
- Actual `usage.cost` telemetry reuses ADR 0003 Decision 9's exact
  semantics (decimal-converted once on receipt, no further float math).
- Display: an **estimated** conservative cost is shown before the user
  commits to "Extract" (the same kind of explicit pre-spend
  confirmation Convene already requires); an **actual** cost is shown
  after a successful attempt. Both are visually and textually distinct
  from the Tribunal run's own cost display (Decision 24) — never
  summed into or mistaken for the $5 figure.

## Decision 10 — Model selection: a dedicated, application-configured extraction model

M7A uses its **own** application-configured extraction model,
independent of the seven Tribunal participant assignments, decided
before dossier content is ever read — dossier content must never
influence model choice. The extraction route is resolved exactly like
any other M7 route: exact endpoint resolution, unique pinnability
(`ENDPOINT_NOT_PINNABLE` blocks exactly as it does for Tribunal
participants), structured-output support required, a bounded-output
parameter with a numeric ceiling (Decision 11, not the advocate/judge
1000/1200 caps — a distinct extraction-specific check), conservative
pricing (Decision 9), no fallback. Reuses `routeResolution.ts`'s
`evaluateEndpoint` with an extraction-specific output-cap/context
requirement substituted for the advocate/judge ones — no new
eligibility-checking mechanism.

## Decision 11 — Token / context bound

```ts
export const EXTRACTION_OUTPUT_CAP_TOKENS = 12_000;
```

Sized generously for the full Decision 5 schema even with substantial
non-ASCII content in a realistic mixed-language dossier (the true
theoretical maximum, with every field maxed using 3-byte characters, is
far larger — around 60,000 conservative tokens — but that extreme is
not what `max_completion_tokens` needs to permit; it is what the
**preflight cost estimate** must conservatively assume the model could
consume, per Decision 9). This is a real, provider-enforced hard
ceiling — not "unbounded" — and is a new, extraction-specific constant,
never `ADVOCATE_OUTPUT_CAP_TOKENS`/`JUDGE_OUTPUT_CAP_TOKENS`.

Input estimation reuses M7's exact methodology
(`netlify/server/openrouter/tokenEstimation.ts`'s `ceil(UTF8
bytes/2)` conservative proxy, no claimed real tokenizer) applied to:
`NORMALIZED_DOSSIER_TEXT_MAX_CHARS` (worst case) + the extraction
system prompt's own fixed overhead (a new
`EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS` constant, computed from the
real prompt string's byte length once drafted — a deferred
implementation detail, not an unresolved design question, since the
*formula* is fully specified here). Context-capacity eligibility reuses
`evaluateEndpoint`'s existing `context_length >= worst-case input +
output cap` check unchanged, with these new numbers substituted.

## Decision 12 — Review and atomic-apply flow: staged preview, never a silent overwrite

A successful (or partially-ambiguous) extraction produces a **preview**
draft, shown on a distinct "Extraction Review" screen — it is **not**
applied to the user's active setup draft automatically. The user's
pre-existing manually-entered draft, if any, is untouched until the
user explicitly presses "Apply extracted draft." A "Cancel"/"Discard"
action on the preview leaves the prior draft exactly as it was.

Any of the following leaves the current active draft completely
unmodified (M5's atomic-import principle, preserved): provider call
failure, timeout, malformed JSON, schema failure, a limit violation
(size/context), or an economics block. Extraction either produces one
complete, internally-consistent preview draft, or it produces nothing
the UI treats as a draft at all.

## Decision 13 — Persistence: minimize retained content, add one new audit table (future migration)

**Not persisted** (deliberately, to minimize retained
untrusted/incidental-personal content beyond what the product already
needs):

- Raw uploaded file bytes — already project policy (`SECURITY.md`),
  unchanged.
- The normalized dossier text itself (post-decode/PDF-extraction,
  pre-model) — no product/audit need for it once the structured result
  exists; retaining it would increase exposure of content the user may
  not have intended to expose as prominently as a Charge Sheet field.
- The raw model extraction JSON, independent of the audit fields in
  Decision 14 — once reviewed/edited by the human, its accepted content
  is indistinguishable from, and persists via, the **existing**
  M5/M6 case + participant-config persistence path when the user
  eventually creates the run. No new "draft" persistence mechanism is
  needed for the draft's *content*.

**Persisted** (new, audit/telemetry only — see Decision 14): one new
`extraction_attempts`-shaped table, added by a **future forward
migration** (not created in this task, consistent with M7's own
discipline of proposing but never applying a migration during
planning). The attempt's relationship to a `cases` row is an open
implementation detail (Open Decisions, below) — extraction typically
happens *before* a case exists, so the attempt record may need to stand
alone (no `case_id`, or a nullable one back-filled later) rather than
requiring a case to already exist.

## Decision 14 — Telemetry / audit fields

Mirrors M7's own anti-fabrication discipline exactly: unknown telemetry
stays `null`; nothing is ever a fabricated zero.

Locked field set for the `extraction_attempts` record: `id`
(`extractionRequestId`), `case_id` (nullable — see Decision 13), source
type, `prompt_version` (`package-extraction-v1`), configured model id,
canonical model id, exact provider endpoint tag, status (one of
Decision 16's codes plus a success/incomplete/ambiguous outcome),
estimated cost (USD, always known — computed at preflight time),
actual input tokens (nullable until a successful response), actual
output tokens (nullable), actual cost (nullable), the warning list
(bounded, ≤40 entries, structured — not raw free text), latency
(nullable), provider request/generation id (nullable), normalized error
code (nullable), `created_at`.

## Decision 15 — Idempotency: separate from `POST /api/runs`

Extraction idempotency is a distinct concern from `POST /api/runs`'s
case+seven-participant freeze idempotency — never conflated.

- The client generates a fresh `extractionRequestId` (UUID) for each
  new logical extraction call (first press, or an explicit "extract
  again" after completion).
- A **retry** of a failed attempt (Decision 8) resubmits the **same**
  `extractionRequestId` — the server recognizes this as the permitted
  one retry of that same logical call.
- An accidental exact-duplicate submission (double-click, a client
  network retry re-sending the identical `extractionRequestId`) is
  idempotent: a request whose id already has an in-progress or
  completed attempt returns that attempt's existing status/result
  rather than starting a second billable call — mirroring `POST
  /api/runs`'s `client_request_id` unique-constraint pattern exactly.
- A dossier edit, or an explicit "start over," always generates a new
  `extractionRequestId` — a genuinely new, separately billable logical
  call, never silently merged with a prior one.

## Decision 16 — Error taxonomy

Hard failures (no draft is produced; the current active draft is
untouched, per Decision 12):

```text
INPUT_INVALID
UNSUPPORTED_FILE_TYPE
FILE_TOO_LARGE
PDF_TEXT_UNAVAILABLE
PDF_ENCRYPTED_OR_INVALID
NORMALIZED_TEXT_EMPTY
INPUT_TOO_LARGE_FOR_MODEL
MODEL_NOT_ELIGIBLE
PRICING_UNAVAILABLE
BLOCKED_BUDGET
PROVIDER_UNAVAILABLE
TIMEOUT
INVALID_STRUCTURED_OUTPUT
```

Successful-but-needs-review outcomes (a draft **is** produced; these
are derived statuses, not model-reported fields — see Decision 6):

```text
EXTRACTION_INCOMPLETE   -- >=1 MISSING_FIELD warning present
EXTRACTION_AMBIGUOUS    -- >=1 AMBIGUOUS_FIELD / AMBIGUOUS_PARTICIPANT_MAPPING warning present
```

A clean extraction (no warnings) is simply `success`.

## Decision 17 — Security

- **Malicious PDF**: `pdfjs-dist`'s text-extraction path never renders
  to canvas and never executes PDF-embedded JavaScript (disabled by
  default and never enabled by this application).
- **Resource exhaustion**: bounded by the 8 MiB raw-byte cap, a
  recommended page-count guard, a bounded extraction wall-clock
  timeout independent of the model-call timeout, and the
  `NORMALIZED_DOSSIER_TEXT_MAX_CHARS` post-extraction cap catching any
  pathological expansion.
- **Decompression/object bombs**: `pdfjs-dist` is a mature, widely
  audited library; this ADR does not claim the risk is fully closed —
  implementation must verify current defensive posture against the
  library's own security notes at install time.
- **Prompt injection**: Decision 7's isolation/instruction contract,
  plus the strict closed schema and mandatory human review, together
  form the defense — not the prompt wording alone.
- **Oversized extracted text**: hard-capped and rejected, never
  silently truncated.
- **Unsafe Unicode/display**: extracted text is rendered as plain text
  only, reusing `SECURITY.md`'s existing "never render raw user/model
  HTML" rule verbatim.
- **Malicious model output**: the closed schema (`.strict()`,
  `additionalProperties: false`, enum-bounded warning codes) is the
  primary defense; extracted strings are never interpreted as anything
  but display/edit text.
- **Secret isolation**: no new secret — the same server-only
  `OPENROUTER_API_KEY` pattern, no browser exposure.
- **No browser-privileged database access**: attempt persistence uses
  the same server-only Supabase service-role pattern M6/M7 already
  use.
- **No raw upload logging**: dossier content (raw or normalized) must
  never appear in server logs — an explicit rule, matching `AGENTS.md`'s
  "avoid unnecessary full-content logging."
- **Public demo data warning**: the existing Charge-Sheet-time privacy
  notice (`docs/ui-spec.md` §Review) must also be shown before
  dossier upload/paste, since free-form dossier text is at least as
  likely to carry incidental personal information as a Charge Sheet.
- **No malware-scanning claim**: file safety in V1 relies solely on
  type/size/structural validation — there is no antivirus/malware
  content scan, and no document claims otherwise.

## Decision 18 — UI flow

```text
New Case
  -> Smart Import (a third import method, alongside existing
     Charge-Sheet-only text import and strict Tribunal Package import)
  -> Upload / Paste dossier
  -> [client-side type/size check] -> Extract (shows estimated cost, requires confirmation)
  -> Extracting (progress state)
  -> Extraction Review (staged preview)
       - unresolved fields visibly highlighted (from warnings, Decision 6)
       - all fields editable
       - warning summary visible
       - source filename/type visible
       - extraction model/version visible at a secondary/collapsible
         audit-detail level (not primary UI real estate)
       - estimated cost (pre-attempt) and actual cost (post-attempt)
         shown, clearly separate from the future Tribunal run cost
       - "Apply extracted draft" / "Cancel" (Decision 12)
  -> existing setup Review (unchanged M5/M6 screen, now populated)
  -> existing normal edit/validation (unchanged)
  -> explicit Convene later (unchanged; never automatic)
```

Failure state: the exact Decision 16 error code surfaced in
user-facing language, with a "Retry" affordance when the failure is
retryable (Decision 8) and a clear "edit and try again" path otherwise.
No automatic navigation into deliberation at any point.

## Decision 19 — API contract

```text
POST /api/setup-extractions
```

Chosen over `/api/extractions` for consistency with the existing
`setup`/`TribunalSetupDraft` naming already used throughout
`src/schemas/tribunalSetup.ts`.

Request (JSON body, matching the existing Netlify Function JSON-body
convention this repository already uses for imports/runs — no
multipart parsing introduced):

```ts
{
  extractionRequestId: string; // uuid, Decision 15
  attemptNumber: 1 | 2;        // 2 only on an explicit retry of the same id
  source:
    | { kind: "text"; text: string }
    | { kind: "file"; filename: string; contentBase64: string };
}
```

Response (200, mirroring `runPreflight`'s pattern of a body-level
status rather than always using HTTP error codes for domain-level
outcomes):

```ts
{
  status: "success" | "needs_review"; // "needs_review" covers both
                                       // EXTRACTION_INCOMPLETE and
                                       // EXTRACTION_AMBIGUOUS (Decision 16) --
                                       // the specific derived status and the
                                       // full warning list live in `warnings`/`attempt`
  draft: {...};
  warnings: [...];
  attempt: {...};
}
  | { status: "blocked" | "failed"; errorCode: <Decision 16 hard-failure code>; message: string; attempt?: {...} }
```

400 for request-shape validation failures (missing/malformed fields);
502 for `PROVIDER_UNAVAILABLE`, mirroring `preflightErrorResponse`'s
existing `ServerConfigError`/`ProviderError` → 502 mapping exactly.

Maximum request size: bounded by the 8 MiB raw-`.pdf` cap (Decision 3)
plus ~33% base64 inflation, ≈10.7 MiB — flagged in Decision 20 as
something implementation must verify against the actual current
Netlify Function payload limit, since that limit varies by plan/tier
and this ADR should not assert a possibly-stale number.

Synchronous, one Function, no Background Function — M7A is exactly one
provider attempt per request (Decision 8); nothing here demands
asynchronous execution.

## Decision 20 — Retry/timeout vs. Netlify Function duration limits

`AGENTS.md` already locks a ≤60-second provider attempt ceiling; a
synchronous serverless Function's own execution deadline is typically
well under that in some tiers/configurations (M7's own live gate
observed `netlify dev`'s local emulator enforcing a 30-second ceiling).
Two 60-second attempts stacked inside one request could therefore
exceed a real Function's deadline.

**Locked resolution**: Decision 8's "one attempt per HTTP request,
retry is a separate explicit client request" structurally avoids ever
needing more than one 60-second attempt inside a single Function
invocation, regardless of the exact current platform limit. This is
the safe design choice; implementation must still verify the actual
production Netlify Function timeout/payload limits for the target
plan/tier before shipping, since those numbers can change and this ADR
does not assert one.

## Decision 21 — PDF dependency / server-only bundle boundary

`pdfjs-dist`'s Node-legacy build is imported **only** from
`netlify/server/...` (a new `netlify/server/extraction/` area,
mirroring `netlify/server/openrouter/`'s existing boundary) — never
from `src/`, exactly matching the existing, verified server/client
separation `scripts/verify-client-bundle.mjs` already enforces for
`OPENROUTER_API_KEY` and the OpenRouter provider code. That script
needs a new forbidden-import/identifier check added for the PDF
library at implementation time (not added in this task). License:
Apache-2.0 (permissive). The Node-legacy entry point has no DOM/canvas
dependency in text-only mode, matching Netlify Functions' Node
runtime.

## Decision 22 — Testing strategy (fixture categories, no implementation)

Deterministic fixtures, zero real OpenRouter calls in the normal
automated suite (matching M7's "the fake provider is exercised, never
the real network" discipline exactly):

- **Text**: valid free-form dossier; missing Charge Sheet field;
  ambiguous participant; prompt-injection text; oversized text;
  non-UTF-8 input.
- **PDF**: valid text PDF; empty-text PDF; scanned/image-only PDF;
  encrypted PDF; malformed PDF; oversized PDF; multi-page extraction;
  unusual text-layer ordering.
- **Model** (fake provider): strict valid JSON; null unresolved
  fields; malformed JSON; an extra/unknown property; an overlong
  field; an invalid warning code; timeout; provider failure; the one
  permitted retry; a budget block.
- **Atomicity**: a failed extraction leaves the current draft
  unchanged; a successful preview does not mutate the active draft
  until Apply; Cancel preserves the prior draft.
- **Economics**: exact Decimal boundary tests at
  `EXTRACTION_HARD_CEILING_USD`; the retry reserve; unknown pricing;
  endpoint pinning.

New test files/locations (planned, not created): `netlify/server/
extraction/` mirroring `netlify/server/openrouter/`'s existing
per-concern file layout (schema, pdf extraction, economics,
idempotency, the API handler).

## Decision 23 — Live gate policy (not performed in this task)

Because M7A's entire value is an actual structured-extraction model
call, a metadata-only smoke (as M7 used) is insufficient to prove the
feature works. **Before this PR merges**, one explicitly-authorized,
low-cost live extraction smoke is required:

- A synthetic, clearly-fictional, non-sensitive test dossier (no real
  course/private data).
- A `FREE`-tier route, if one is eligible at smoke time — target spend
  `$0.00`; `EXTRACTION_HARD_CEILING_USD` remains the hard safety
  backstop regardless.
- Expected result: schema-only structured output validated end to end;
  the real `extraction_attempts` audit path exercised; no real dossier
  content persisted beyond the bounded audit fields (Decision 14).
- Explicit human authorization required immediately before the call —
  the same standing rule this project has followed for every prior
  live OpenRouter interaction.
- **Not performed by this planning task.**

## Decision 24 — Cognified-software accounting

The setup extraction call is cognified software — real model reasoning
runs during product use, not merely at development time. It is
nonetheless a **setup-time** call: not an advocate, not a judge, not
one of the fixed seven Tribunal logical calls. A successful Tribunal
run remains **exactly 7 logical model calls** on a no-retry success —
this ADR changes nothing about that count. Extraction economics
(Decision 9) are computed, displayed, and audited **separately** from
the seven-call Tribunal run's economics, never folded into the $5/7-call
figure — visible as a distinct line item in both the Extraction Review
UI (Decision 18) and the audit record (Decision 14).

## Consequences

M7A can be implemented against this ADR without inventing material
product/economics/security decisions mid-implementation. The remaining
open items (below) are narrow, implementation-time verification tasks,
not unresolved design questions.

## Open Decisions (implementation-time, not blocking this plan)

1. Exact `case_id` relationship for `extraction_attempts` (standalone
   vs. nullable FK back-filled once a case exists) — a migration
   design detail, not a product-behavior question.
2. Exact current Netlify Function synchronous-execution and
   request-payload limits for the target plan/tier — verify before
   implementation; the architecture (Decision 20) does not depend on
   the precise number.
3. Exact recommended PDF page-count guard and extraction wall-clock
   timeout values — bounded by `NORMALIZED_DOSSIER_TEXT_MAX_CHARS`
   downstream regardless of the exact number chosen.
4. Exact `EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS` value — computed
   from the real extraction system prompt's byte length once drafted
   (formula locked in Decision 11; the prompt text does not exist
   yet).
5. `pdfjs-dist`'s current exact version/security posture — verify at
   dependency-addition time, per `AGENTS.md`'s standing
   dependency-addition rule.
