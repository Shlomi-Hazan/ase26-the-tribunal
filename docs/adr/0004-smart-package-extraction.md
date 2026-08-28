# ADR 0004 — Smart Tribunal Package Extraction (Milestone 7A)

## Status

Proposed (planning/specification gate). Locks the architectural
decisions needed before M7A implementation begins. Does **not**
authorize implementation, dependency installation, a database
migration, or any real OpenRouter model request. Written on branch
`milestone/07a-smart-package-extraction`, base `main` at
`926ba66cace83347a1a3f27f46921819213dd6b5` (the M7 merge commit).

**First independent-review correction pass:** an independent review of
the first version of this ADR found nine material planning defects — a
Netlify request-payload/PDF-size mismatch, a synchronous-
Function-timeout/provider-timeout mismatch, an impossible planning-PR
live-gate timing requirement, a logical-call/provider-attempt audit gap
that could lose attempt-level evidence, a client-declared retry-authority
gap, a false Tribunal-tier/extraction-eligibility inference, an
output-cap/schema-maximum mismatch, a warning-path/uncertainty-policy
gap, and an unspecified extraction-model configuration location. All
nine were corrected (each marked "corrected this pass" at the time).

**Second, deeper independent-review correction pass (this revision):**
a further audit of the now-concrete retry/audit/API contract found four
additional material consistency defects plus one minor
current-dependency wording error — a retry-input contradiction (the
retry endpoint required no body while retention policy forbids
persisting the dossier server-side, making attempt #2 impossible to
construct); a missing semantic fingerprint (nothing proved a
replayed/retried request was the *same* logical extraction); an
incomplete atomic pre-spend claim (the earlier `UNIQUE` constraint
alone did not prevent two concurrent requests from both spending before
racing on the insert); a mischaracterization of the attempt row as
"immutable, insert-only" that conflicted with claiming it before spend;
an incomplete output-cap "formal" bound (the 3-byte-per-code-unit
assumption did not account for JSON control-character escaping, which
can cost up to 6 bytes); and stale `pdfjs-dist` Node-version wording.
All are corrected below (each marked "corrected this pass" for this
second revision, distinguished from the first pass's own markers by
context); a pre-spend read-only quote endpoint and an explicit
Function-death/ambiguous-claim fail-closed policy were also added,
closing two further gaps this deeper audit surfaced. Nothing from
either prior version is silently erased. Full findings and corrections
(this pass): Decisions 5, 9, 11, 13, 14, 15, 18, 19, 22, and the Open
Decisions list.

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
| `.pdf` | `SMART_EXTRACTION_PDF_MAX_RAW_BYTES = 4 * 1024 * 1024` (4 MiB) raw bytes | text-layer extraction only (Decision 4); the **extracted** text is still bound by `NORMALIZED_DOSSIER_TEXT_MAX_CHARS` |

**Corrected this pass (independent review):** the PDF raw limit was
originally 8 MiB, which — inside a JSON/base64 request body (Decision
19) — cannot fit under Netlify's documented, reverified,
non-configurable 6 MB buffered request-payload limit (Decision 20). 4
MiB raw is ≈5.33 MiB after ~33% base64 inflation, leaving real headroom
below 6 MB for the JSON envelope, filename, and idempotency metadata.
4.5 MiB (the platform's own effective-binary-limit number) was
deliberately **not** chosen — it would leave effectively no room for
that envelope.

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

**Recommended, not installed — general choice reconfirmed by
independent review, twice.** `pdfjs-dist` (Mozilla's PDF.js,
Apache-2.0, the library behind Firefox's built-in PDF viewer) via its
`legacy` Node-compatible entry point
(`pdfjs-dist/legacy/build/pdf.mjs`), calling `getTextContent()` per
page — no rendering, no canvas, no `node-canvas` native dependency, no
image processing. Reverified directly against the package's current
official README/npm/registry listing: Apache-2.0 confirmed, actively
published on npm (latest observed during this pass: `6.2.108`), the
exact `pdfjs-dist/legacy/build/pdf.mjs` import path confirmed as the
documented Node-compatible entry point.

**Corrected this pass (deeper independent review) — the runtime
requirement wording was stale.** The prior pass cited "Node.js ≥18
documented as required," which was accurate for older `pdfjs-dist`
majors but not the current `6.x` line: current `6.x` package metadata
observed during this pass requires a materially newer Node runtime
(`>=22.13.0 || >=24`, per the package's own `engines` field as of
`6.0.227`+). This is **not a compatibility blocker** — the repository
already runs Node 24. Current `pdfjs-dist` runtime requirements must
still be reverified at the exact version pin chosen at
dependency-addition time (Open Decisions, below); this ADR only
confirms the repository's Node 24 runtime is compatible with the `6.x`
requirement observed during this planning pass, not a permanent
guarantee that stays true for every future `pdfjs-dist` release. (The
exact current version/security posture remains, correctly, an
implementation-time verification item, Open Decisions below; this
general library choice is approved, not a risk-closure claim.)

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

// Corrected this pass (independent review, Decision 11): every free-text
// output field uses this shared refinement instead of bare
// z.string().trim().max(N) -- see Decision 11 for why. Excludes C0
// control characters other than newline/tab (which JSON escapes to a
// fixed 2 bytes) and DEL, and requires well-formed UTF-16 (no lone/
// unpaired surrogates) -- both are exactly the classes of code unit that
// can otherwise inflate a single JSON-serialized character beyond the
// assumed 3-UTF-8-byte worst case (e.g. a raw control character with no
// named JSON escape serializes as `\u00XX`, 6 ASCII bytes).
const safeExtractionText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .refine((value) => value.isWellFormed(), {
      message: "Text must not contain unpaired Unicode surrogates."
    })
    .refine((value) => !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value), {
      message: "Text must not contain control characters other than newline/tab."
    });

const chargeSheetExtractionSchema = z.object({
  defendant: safeExtractionText(200).nullable(),
  act: safeExtractionText(6000).nullable(),
  exactQuestion: safeExtractionText(1000).nullable()
}).strict();

const participantExtractionSchema = z.object({
  profileName: safeExtractionText(120).nullable(),
  personality: safeExtractionText(4000).nullable()
}).strict();

// Corrected this pass (independent review): `field` was a free-text
// string (max 80 chars) -- not a closed, machine-readable pointer.
// Replaced with an exact, closed enum of every valid leaf path in the
// schema (3 Charge Sheet fields + 7 seats x 2 fields = 17 paths), plus
// `null` for a genuinely document-wide warning. No arbitrary path is
// representable. The JSON Schema (response_format.json_schema) mirrors
// this exact enum, not a free string.
const extractionFieldPathSchema = z.enum([
  "chargeSheet.defendant",
  "chargeSheet.act",
  "chargeSheet.exactQuestion",
  "participants.PRO_1.profileName",
  "participants.PRO_1.personality",
  "participants.PRO_2.profileName",
  "participants.PRO_2.personality",
  "participants.CON_1.profileName",
  "participants.CON_1.personality",
  "participants.CON_2.profileName",
  "participants.CON_2.personality",
  "participants.JUDGE_1.profileName",
  "participants.JUDGE_1.personality",
  "participants.JUDGE_2.profileName",
  "participants.JUDGE_2.personality",
  "participants.JUDGE_3.profileName",
  "participants.JUDGE_3.personality"
]);

const extractionWarningSchema = z.object({
  code: z.enum([
    "MISSING_FIELD",
    "AMBIGUOUS_FIELD",
    "AMBIGUOUS_PARTICIPANT_MAPPING",
    "UNSUPPORTED_CONTENT_IGNORED",
    "LOW_CONFIDENCE_EXTRACTION"
  ]),
  field: extractionFieldPathSchema.nullable() // null only for a genuinely document-wide warning
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
later be re-validated against. The `safeExtractionText` character-class
restriction (new this pass) is **additive** to those existing bounds,
never a reduction of them — it excludes only content classes (raw
control characters other than newline/tab, DEL, unpaired surrogates)
that legitimate personality/Charge-Sheet prose has no real need for, in
exchange for making Decision 11's output-cap bound actually provable.
The paired JSON Schema (sent as `response_format.json_schema`,
mirroring `src/prompts/schemas.ts`'s existing
`advocateSpeechJsonSchema`/`judgeVerdictJsonSchema` pattern exactly)
uses `additionalProperties: false` at every level and a `pattern`
constraint mirroring the same excluded-character-class regex (JSON
Schema cannot express a Unicode well-formedness check directly, so
server-side Zod validation remains the authoritative enforcement for
the surrogate-pairing rule — the JSON Schema `pattern` is defense-in-depth,
not the sole gate). No `side`, `role`, `seatId`, model assignment,
prompt version, execution mode, provider endpoint, pricing, or run
status field exists anywhere in this schema — they are structurally
absent, not merely instructed away.

## Decision 6 — Ambiguity / null policy and warning taxonomy

The extraction model must never fabricate a value it cannot support
from the dossier text. Locked mapping (**tightened this pass —
independent review found the original `LOW_CONFIDENCE_EXTRACTION` row
weakened the "uncertainty becomes unresolved" contract, and the table
did not distinguish required from optional fields**):

| Situation | Field value | Warning |
|---|---|---|
| Clearly supported value found | the extracted value | none |
| Absent **required** field (`defendant`/`act`/`exactQuestion`/any seat's `personality`) | `null` | `MISSING_FIELD` |
| Absent **optional** field (any seat's `profileName`) | `null` | **none** — see below |
| Multiple conflicting plausible values | `null` | `AMBIGUOUS_FIELD` |
| Uncertain which dossier section maps to which seat | `null` on the affected seat(s) | `AMBIGUOUS_PARTICIPANT_MAPPING` |
| Dossier content the schema has no field for (e.g. an attempted model/execution assignment) | ignored, never mapped | `UNSUPPORTED_CONTENT_IGNORED` |
| A value is inferable but the model is not confident it is correct | `null` (**corrected this pass — never the uncertain value itself**) | `LOW_CONFIDENCE_EXTRACTION` |

**Optional-field policy (locked this pass):** `profileName` is the only
schema field the downstream `participantDraftSchema` (`src/schemas/
tribunalSetup.ts`) already treats as optional (`.optional()`, unlike
`personality`'s `.min(1)`). An absent `profileName` is expected,
ordinary behavior — most free-form dossiers will not name a distinct
"profile" per seat — and must **not** produce a `MISSING_FIELD`
warning and must **not** contribute to the derived `EXTRACTION_INCOMPLETE`
status. `MISSING_FIELD` is reserved for the four genuinely required
field types.

**Low-confidence policy (corrected this pass):** a value the model is
not confident about must be nulled out exactly like `MISSING_FIELD`/
`AMBIGUOUS_FIELD` — never passed through as a non-null value merely
because it is syntactically well-formed. A non-null value must never
reach the human-editable draft, and therefore must never be able to
slip past existing Convene validation, solely because the model
happened to phrase an uncertain guess as a plausible-looking string.
`LOW_CONFIDENCE_EXTRACTION` is retained as a **distinct** warning code
from `MISSING_FIELD` (not merged with it) because it carries different
diagnostic meaning for the human reviewer — "I found something that
might be right, but couldn't confirm it" vs. "I found nothing at all"
— even though both now null the field identically.

A **closed, generic** warning-code enum (five codes) plus a closed
`field`-path enum (Decision 5) is used instead of one bespoke code per
field (e.g. `MISSING_PRO_2_PERSONALITY`) — the same information is
expressed with an order-of-magnitude smaller, easier-to-maintain enum,
fully machine-readable and exhaustively enumerable. This is a
deliberate generalization of the illustrative codes named in the
roadmap-level idea, not a silent deviation — the illustrative list was
never a mandated exact enum.

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
- **Provider attempt timeout — corrected this pass (independent
  review)**: `PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS = 45_000` ms, a
  **new, extraction-specific** constant — not a reuse of M7's
  `PROVIDER_ATTEMPT_TIMEOUT_MS` (60,000 ms). `AGENTS.md`'s "provider
  attempt timeout <= 60 seconds" is a ceiling on the provider attempt
  itself, not a promise that the surrounding synchronous Function
  invocation has any time left over once the attempt returns. Netlify's
  own synchronous Function execution limit is **also** 60 seconds,
  non-configurable (reverified against current official documentation,
  Decision 20) — a 60-second provider attempt would leave **zero**
  headroom for input validation, PDF extraction, Supabase
  audit/idempotency work, route/pricing resolution, budget preflight,
  response parsing, and serialization, all of which happen in the same
  Function invocation. 45 seconds leaves that other work a real,
  bounded 15-second budget within the Function's 60-second hard
  ceiling — the complete Function invocation still depends on
  Netlify's 60-second limit; 45 seconds is the provider-attempt
  ceiling *within* it, not a claim that everything else takes exactly
  15 seconds. This is an M7A-specific policy; M7's own
  `PROVIDER_ATTEMPT_TIMEOUT_MS` for future Tribunal execution is
  unmodified.
- **Retry is NOT an automatic in-request loop.** The initial `POST
  /api/setup-extractions` request performs **exactly one** provider
  attempt. If that attempt fails with a retryable reason, the response
  tells the client so; the client must call the separate, explicit
  `POST /api/setup-extractions/{extractionRequestId}/retry` endpoint
  (Decision 15) to make the second attempt as a genuinely separate HTTP
  request. This is a structural choice, not merely a numeric one: it
  guarantees no single Function invocation ever needs to complete more
  than one 45-second provider attempt, comfortably inside the
  reverified 60-second Function ceiling.
- A user editing the dossier and pressing "Extract" fresh, or
  explicitly choosing to extract again after a completed attempt,
  starts a **new** logical call (new `extractionRequestId`, a new,
  separately billable attempt) — never confused with a retry of the
  same call (Decision 15).

## Decision 9 — Extraction economics: a dedicated ceiling, per logical call, tier-independent

The `$5.00` Tribunal hard ceiling is per complete seven-call run and
must not be redefined or silently absorb this call
(`docs/economics.md` §22, `AGENTS.md`). A **separate, explicit,
smaller** ceiling is locked for extraction:

```ts
export const EXTRACTION_HARD_CEILING_USD = new Decimal("0.50");
```

**Scope of the ceiling — corrected this pass (independent review):**
`EXTRACTION_HARD_CEILING_USD` bounds the **complete logical extraction
call**, including **both** permitted provider attempts (Decision 8),
not each provider attempt independently. It is not "$0.50 per attempt."

**Why $0.50 — corrected this pass:** $0.50 happens to equal the
existing `BUDGET` tier's upper bound
(`docs/adr/0003-openrouter-infrastructure.md` Decision 12,
`TIER_THRESHOLDS_USD.BUDGET_MAX`), chosen for product simplicity — it
is a familiar, already-approved monetary threshold, reused as a number,
**not** as a policy inference. The M7 `FREE`/`BUDGET`/`PREMIUM` tier
labels are computed from **complete-Tribunal** economics (4 advocates +
3 judges, ×2 retry, ×1.10 safety factor) — a structurally different
workload from one extraction call. **Extraction eligibility must never
be inferred from a route's Tribunal tier label:**

- A route labeled `PREMIUM` for full-Tribunal economics may still be
  extraction-eligible, if its extraction-specific conservative maximum
  (below) is `<= $0.50`.
- A route labeled `BUDGET` for full-Tribunal economics may still be
  extraction-**in**eligible, if extraction's much larger single-call
  workload (Decision 11) pushes its extraction-specific conservative
  maximum above `$0.50`.

**`$0.50` is a chosen M7A policy ceiling, reusing a familiar existing
monetary threshold for product simplicity; extraction-specific Decimal
preflight is authoritative.** The `classifyPriceTier`/`TIER_THRESHOLDS_USD`
Tribunal-tier classifier is never called anywhere in the extraction
eligibility/preflight path.

Illustrative-only worked estimate (**not** a Tribunal-tier proof — an
arbitrary example rate used only to sanity-check plausibility, per this
pass's correction):

- Worst-case input: `NORMALIZED_DOSSIER_TEXT_MAX_CHARS` (40,000) × 3
  bytes/char + prompt/schema overhead ≈ 120,000+ bytes ÷ 2 (M7's
  `ceil(bytes/2)` conservative-token proxy) ≈ 60,000+ conservative
  input tokens.
- Output cap (Decision 11, corrected this pass to a formally proven
  bound): `65,000` tokens.
- At an illustrative example rate of $1/M prompt, $2/M completion
  (chosen only for this sanity check, never asserted as a tier
  boundary): `60,000 × $1e-6 + 65,000 × $2e-6 ≈ $0.19` per attempt.
- ×2 attempts × 1.10 safety factor ≈ **$0.418** per logical extraction
  — inside the $0.50 ceiling, but with materially less margin than
  before the output-cap correction (Decision 11). This is disclosed
  honestly rather than smoothed over: at the corrected, formally proven
  output-cap size, only routes priced meaningfully below this
  illustrative example rate have comfortable headroom under $0.50 —
  which is consistent with, not contrary to, `INTENT.md` §10's
  preference for free/very-low-cost extraction models, but means the
  eligible-route set may be narrower in practice than the pre-correction
  estimate implied. If real extraction attempts routinely approach this
  margin, the $0.50 ceiling itself should be revisited as a future,
  separately reviewed decision — not silently loosened here.

Locked policy, otherwise mirroring M7's preflight exactly:

- Decimal arithmetic throughout (`decimal.js`, no new library).
- **Two-stage preflight — corrected this pass (independent review) to
  close a pre-spend-confirmation gap.** The prior version described
  only an "initial preflight" performed as part of the billable call
  itself, with no server-authoritative way for the UI to show the user
  a quote *before* they commit to spending. Now split into:
  1. A **read-only, non-billable quote** (`POST
     /api/setup-extractions/preflight`, Decision 19) the UI calls after
     upload/paste and before the user presses "Confirm & Extract" —
     reserves conservatively for **both** possible attempts
     (worst-case-input + full-output-cap, priced at the resolved
     route's actual rates, × 2 attempts × 1.10 safety factor, compared
     against `EXTRACTION_HARD_CEILING_USD`), makes **zero**
     `createChatCompletion`/provider-inference calls, and returns the
     result for display (Decision 18).
  2. An **authoritative re-check inside the atomic claim** (Decision
     15) immediately before the billable initial `POST
     /api/setup-extractions` call is permitted to reach the provider —
     the same computation, rerun fresh, never trusting the browser's
     earlier quote as authoritative (pricing/eligibility may have
     changed between the quote and the confirm). Insufficient budget at
     *this* stage blocks with `BLOCKED_BUDGET` before any spend, exactly
     as before — the quote step changes *when the user sees an
     estimate*, not the authority of the pre-spend guard itself.
- **Retry preflight — corrected this pass (independent review):**
  before the `POST .../retry` call is permitted to reach the provider,
  the server re-runs an authoritative guard using
  `actual known spend from attempt #1` (from
  `setup_extraction_attempts`, Decision 13/14 — never an estimate once
  the real value is known) `+ conservative maximum for attempt #2`
  (worst-case-input + full-output-cap × 1.10 safety factor, using
  **freshly re-checked** route/pricing metadata per M7's existing
  5-minute-TTL freshness rules — pricing may have moved since attempt
  #1) `<= EXTRACTION_HARD_CEILING_USD`. If this guard fails, the retry
  is blocked with `BLOCKED_BUDGET` and **no second provider call
  occurs** — attempt #1's already-incurred spend and its audit record
  are never lost or rewritten (Decision 13).
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
- Display: the read-only preflight quote's **estimated** conservative
  cost is shown before the user commits to "Confirm & Extract" (the
  same kind of explicit pre-spend confirmation Convene already
  requires); an **actual** cost is shown after a successful attempt,
  and a running total (attempt #1 actual + attempt #2 estimate/actual)
  is shown before/after a retry so the user always sees the logical
  call's cumulative spend against $0.50, not a per-attempt figure in
  isolation. Both are visually and textually distinct from the Tribunal
  run's own cost display (Decision 24) — never summed into or mistaken
  for the $5 figure.

## Decision 10 — Model selection: a dedicated, server-only configured extraction model

M7A uses its **own** application-configured extraction model,
independent of the seven Tribunal participant assignments, decided
before dossier content is ever read — dossier content must never
influence model choice.

**Configuration location — locked this pass (independent review found
the prior wording named no concrete location):**

```text
PACKAGE_EXTRACTION_MODEL_ID
```

A server-only environment/configuration variable (same category as
`OPENROUTER_API_KEY`'s configuration pattern, though not itself a
secret — a plain model identifier string), read exclusively by
server-side code. Requirements:

- **No browser secret/config authority**: never read from, sent to, or
  settable by client code — `scripts/verify-client-bundle.mjs`'s
  existing forbidden-identifier check is a template for enforcing this
  at implementation time.
- **No dossier-controlled model choice**: the configured value is fixed
  before any request is processed; dossier content is never consulted.
- **No silent default to a paid model**: if `PACKAGE_EXTRACTION_MODEL_ID`
  is missing or does not resolve to an eligible route, the request
  fails with a stable configuration/model-eligibility error
  (`MODEL_NOT_ELIGIBLE`, Decision 16) — never silently substitutes a
  different, possibly paid, model.
- The actual canonical model id and exact endpoint are still resolved
  through M7's existing route-resolution/pricing machinery (below), not
  taken as given from the configuration string alone.
- The UI may display the resolved model as audit information
  (Decision 18), but cannot mutate `PACKAGE_EXTRACTION_MODEL_ID` in V1
  — it is a deploy-time/server configuration value, not a runtime user
  setting.

The extraction route is resolved exactly like any other M7 route: exact
endpoint resolution, unique pinnability (`ENDPOINT_NOT_PINNABLE` blocks
exactly as it does for Tribunal participants), structured-output
support required, a bounded-output parameter with a numeric ceiling
(Decision 11, not the advocate/judge 1000/1200 caps — a distinct
extraction-specific check), conservative pricing evaluated on its own
extraction-specific terms, never inferred from a Tribunal tier label
(Decision 9), no fallback. Reuses `routeResolution.ts`'s
`evaluateEndpoint` with an extraction-specific output-cap/context
requirement substituted for the advocate/judge ones — no new
eligibility-checking mechanism.

## Decision 11 — Token / context bound: output cap formally derived, not a "realistic" guess

**Corrected this pass (independent review):** the previous
`EXTRACTION_OUTPUT_CAP_TOKENS = 12_000` was an under-estimate that
structurally forbade the model from ever completing a fully valid
worst-case (but schema-legal) response — a legitimately long personality
description near its 4,000-character limit could hit the 12,000-token
`max_completion_tokens` ceiling mid-generation, producing a truncated,
`INVALID_STRUCTURED_OUTPUT` response for content that would have been
perfectly valid if the model had been allowed to finish. A valid,
schema-legal extraction must never be structurally impossible merely
because the output cap is smaller than the schema's own maximum
representable shape. Resolved via the **preferred** option (a formally
derived bound from the actual maximum serialized shape), not by
silently shrinking the schema's field limits below the existing
downstream `TribunalSetupDraft` bounds.

**Corrected again this pass (deeper independent review): the prior
"formal" computation was still not actually formal.** `content chars x
3 UTF-8 bytes` is not a valid bound on *serialized JSON* bytes on its
own — `z.string().trim().max(N)` alone does not exclude control
characters or unpaired Unicode surrogates, and JSON serialization can
expand a single such code unit to more than 3 bytes (e.g. a raw C0
control character with no named JSON escape serializes as `\u00XX`, 6
ASCII bytes — double the assumed maximum). Resolved by making the
**precondition** true rather than continuing to assert an unproven
bound: Decision 5's `safeExtractionText` refinement now excludes, on
every free-text field, exactly the code-unit classes that could exceed
3 bytes once JSON-serialized (C0 control characters other than
newline/tab, DEL, and unpaired surrogates via `.isWellFormed()`). Under
that precondition, every remaining representable character either (a)
needs no JSON escape and costs its raw UTF-8 byte count (at most 3
bytes for any BMP code unit, including the CJK worst case; a
surrogate-pair character costs 4 bytes for 2 code units = 2 bytes/unit,
already under the bound), or (b) is one of the four characters JSON
*does* require escaping — `"`, `\`, `\n`, `\t` — each of which escapes
to exactly 2 ASCII bytes, still under 3. **With `safeExtractionText` in
place, `3 bytes per code unit` is now a true, provable maximum of the
serialized JSON output**, not an assumption.

**Formal worst-case computation** (Decision 5's schema, all fields
populated at their `safeExtractionText`-constrained maximum, matching
M7's `worstCaseAdvocateInputTokens()` methodology exactly — also
corrected this pass: the warnings-row byte count previously referenced
the pre-correction 80-character free-text `field` maximum; `field` is
now Decision 5's closed 17-entry enum, whose longest member,
`"participants.JUDGE_1.profileName"` / `"...personality"`, is 32
characters, not 80):

```text
content chars =
    chargeSheet          (200 + 6000 + 1000)                =  7,200
  + participants (x7)    (120 + 4000) x 7                   = 28,840
  + warnings (x40)       (30 [longest code] + 32 [longest field path]) x40 = 2,480
                                                              --------
  total content chars                                        = 38,520

content bytes  = 38,520 x 3 (3-byte UTF-8 worst case, now a
                 true bound under safeExtractionText)         = 115,560
structural JSON overhead (keys/braces/quotes/commas, ASCII,
                 application-controlled, not model output)   ~=   3,000
                                                              --------
total worst-case bytes                                       ~= 118,560

conservative tokens = ceil(bytes / 2)  (M7's proxy)           ~=  59,280
```

```ts
export const EXTRACTION_OUTPUT_CAP_TOKENS = 65_000;
```

`65,000` remains the locked cap — unchanged in value, now resting on a
genuinely formal bound (`59,280`, tighter than the prior pass's
`62,160` once the field-path correction is applied) with slightly more
margin than before, not less. It is a real, provider-enforced
`max_completion_tokens` ceiling — **not** "unbounded" — never the
schema's field bounds themselves being narrowed. It is a new,
extraction-specific constant, never
`ADVOCATE_OUTPUT_CAP_TOKENS`/`JUDGE_OUTPUT_CAP_TOKENS`.

**Disclosed tradeoff, per this pass's explicit review instruction not
to smooth this over:** a 65,000-token output requirement is
substantially larger than any Tribunal participant's cap (1,000/1,200)
and may exceed the maximum output window some genuinely free/cheap
OpenRouter models support — narrowing the practically eligible route
set for extraction below what the original (under-proven) 12,000-token
cap implied, and tightening the $0.50 economics margin (Decision 9).
This is accepted as the correct, honest resolution rather than a
convenient understatement; whether real-catalog model availability at
this bound is workable in practice is a live-gate/implementation-time
observation (Open Decisions, below), not something this ADR can verify
without real metadata.

**Model feasibility context (added this pass, independent review):**
this correction is not evidence that no practical model exists at this
bound — the review that raised it also cited several plausible
high-output structured-output-capable candidates as illustrative
examples (e.g. models publicly advertising roughly 1,000,000-token
context with tens-of-thousands-to-128,000-token maximum output and
structured-output support). **These specific figures are cited as the
review's own illustrative examples, not independently reverified
against live OpenRouter metadata in this planning-only task** (this
task does not authorize a real OpenRouter metadata request, even a
read-only one, without separate explicit authorization) — they do not
substitute for M7's actual endpoint-level live eligibility,
pinnability, pricing-overrides, or freshness checks, which remain
exactly what Decision 10's route resolution already requires. The
point is narrower and still holds without independent reverification:
`65,000` is a real, achievable output-window size in the current model
landscape in principle, not a bound that presumes no model could ever
satisfy it.

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

## Decision 13 — Persistence: two-table audit model with a claim-then-terminal attempt lifecycle, future migration

**Not persisted** (deliberately, to minimize retained
untrusted/incidental-personal content beyond what the product already
needs) — **unchanged by this pass's corrections below**, which resolve
retry/concurrency safety without weakening this:

- Raw uploaded file bytes — already project policy (`SECURITY.md`),
  unchanged.
- The normalized dossier text itself (post-decode/PDF-extraction,
  pre-model) — no product/audit need for it once the structured result
  exists; retaining it would increase exposure of content the user may
  not have intended to expose as prominently as a Charge Sheet field.
- The raw model extraction JSON, independent of the audit fields below
  — once reviewed/edited by the human, its accepted content is
  indistinguishable from, and persists via, the **existing** M5/M6 case
  + participant-config persistence path when the user eventually
  creates the run. No new "draft" persistence mechanism is needed for
  the draft's *content*.

**Persisted: two tables, not one** (unchanged from the prior pass's
correction — still needed, since a logical extraction can have two
distinct provider attempts with materially different, independently
auditable outcomes). **Corrected this pass (deeper independent
review):** the attempt row's lifecycle and `setup_extractions`' own
shape both needed further correction — see the annotations inline
below.

```text
setup_extractions                       -- ONE row per logical call
  id                    = extractionRequestId
  case_id               nullable (see below)
  source_type
  request_fingerprint    -- NEW this pass, see Decision 15
  prompt_version         ('package-extraction-v1')
  configured_model_id
  final_status           (one of Decision 16's outcomes, once terminal)
  created_at
  completed_at           nullable until terminal

setup_extraction_attempts                -- ONE row per provider-attempt SLOT, claimed before spend
  id
  extraction_request_id  FK -> setup_extractions.id
  attempt_number          1 | 2
  status                  -- CLAIMED (see Decision 15) as its FIRST value,
                           -- then transitions EXACTLY ONCE to one terminal
                           -- value (a Decision 16 code, or success/
                           -- incomplete/ambiguous) -- never "immutable
                           -- from insertion", see below
  canonical_model_id      -- fixed at claim time, before the provider call
  provider_endpoint_tag   -- fixed at claim time
  estimated_cost_usd      -- fixed at claim time (that attempt's preflight)
  actual_input_tokens     nullable -- see Decision 14: recorded whenever
                           -- the provider supplies it, not only on
                           -- application-level success
  actual_output_tokens    nullable
  actual_cost_usd         nullable
  latency_ms              nullable
  provider_request_id     nullable
  error_code              nullable
  created_at              -- claim time
  completed_at            nullable until terminal

  UNIQUE (extraction_request_id, attempt_number)
```

**Corrected this pass: "immutable, insert-only" was the wrong
description of the attempt lifecycle, and conflicted with the atomic
pre-spend claim this pass introduces (Decision 15).** An attempt row
cannot be inserted *after* a successful provider call and also be
"claimed before spend" — claiming necessarily means the row exists
(in a non-terminal state) before the provider is ever called. The
corrected, precise contract:

- **Identity/authorization fields are fixed at claim time and never
  rewritten**: `attempt_number`, `canonical_model_id`,
  `provider_endpoint_tag`, `estimated_cost_usd` (the exact route/pricing
  snapshot that authorized this attempt to proceed) are written once,
  at claim, and read-only thereafter.
- **`status` starts at `CLAIMED` and transitions exactly once**, to
  exactly one terminal value, when the provider call (or its absence —
  e.g. a preflight-stage failure that never reached the provider)
  resolves.
- **Once terminal, the row is immutable** — this is where "immutable"
  correctly applies: after the one status transition, nothing about
  that attempt's row is ever rewritten again.
- **Attempt #2 is a different row, never an overwrite of attempt #1's
  row** — this part of the prior pass's correction is unchanged and
  still exactly right.

The `UNIQUE(extraction_request_id, attempt_number)` constraint remains
the server-authoritative mechanism preventing a duplicate attempt row —
but this pass corrects *when* it must be enforced: the constraint must
back the **claim insert itself** (Decision 15), not merely a
"who gets recorded" bookkeeping step. The attempt's relationship to a
`cases` row is an open implementation detail (Open Decisions, below) —
extraction typically happens *before* a case exists, so
`setup_extractions.case_id` may need to stand alone (nullable,
possibly back-filled later) rather than requiring a case to already
exist.

## Decision 14 — Telemetry / audit fields

Mirrors M7's own anti-fabrication discipline exactly: unknown telemetry
stays `null`; nothing is ever a fabricated zero. Field set is exactly
Decision 13's two-table shape — `setup_extractions` carries the
logical-call identity (including `request_fingerprint`, Decision 15)
and terminal status; each `setup_extraction_attempts` row carries that
specific attempt's claimed identity plus its terminal
model/endpoint/cost/token/latency/provider-id/error evidence. The
warning list (bounded, ≤40 entries, using Decision 5/6's closed
code/field enums — never raw free text) is recorded per attempt, since
different attempts of the same logical call can produce different
warnings.

**Corrected this pass (independent review): actual token/cost/provider-id
telemetry must never be phrased as "only known on a successful
extraction."** A provider request can return successfully — and incur
real, billable usage/cost — even when the application subsequently
rejects the response's structured-output shape as
`INVALID_STRUCTURED_OUTPUT`. The precise rule: `actual_input_tokens`/
`actual_output_tokens`/`actual_cost_usd`/`provider_request_id` are
recorded on that attempt's row whenever the **provider itself supplied
them** (i.e. a response was received at all), independent of whether
the application-level extraction result is `success`,
`EXTRACTION_INCOMPLETE`/`EXTRACTION_AMBIGUOUS`, or
`INVALID_STRUCTURED_OUTPUT`. They remain `null` only when the provider
call itself never returned a usable response (timeout, network
failure, a non-2xx before any body was parseable) — never "null until
success."

## Decision 15 — Idempotency, retry input, semantic fingerprint, and atomic pre-spend claim

Extraction idempotency is a distinct concern from `POST /api/runs`'s
case+seven-participant freeze idempotency — never conflated. This
decision is substantially rewritten this pass (deeper independent
review found three compounding gaps in the prior version, corrected
together since they interact): the retry endpoint was contradictorily
specified as bodiless while retention policy forbids storing the
dossier server-side; nothing proved a retried/replayed request was
semantically the *same* logical extraction; and the `UNIQUE` constraint
alone does not prevent a race if the provider call happens before the
attempt is claimed.

### Retry input — corrected this pass (independent review)

The prior version required the retry endpoint to accept no body while
also stating raw dossier bytes and normalized dossier text are never
persisted — contradictory, since attempt #2 needs the same dossier
content to construct its request and the server has nowhere to read it
back from. **Resolved by having the client resend the source on
retry**, exactly like the initial call — the retention policy is
unchanged (still nothing dossier-derived is persisted; Decision 13
stands):

```ts
POST /api/setup-extractions/{extractionRequestId}/retry
{
  source:
    | { kind: "text"; text: string }
    | { kind: "file"; filename: string; contentBase64: string };
}
```

The server deterministically re-validates, re-normalizes, and (for a
`.pdf`) re-extracts this resent source exactly as the initial call
does, before any provider call — the same deterministic pipeline,
never a shortcut. The resent source's normalized form must reproduce
the **same semantic fingerprint** (below) as the logical extraction's
original request — a client resending a *different* dossier under the
same `extractionRequestId` is not a retry of the same logical call and
must be rejected, not silently treated as one.

### Semantic fingerprint — new this pass (independent review)

`setup_extractions` gains `request_fingerprint`, computed
server-side using the repository's existing idempotency-fingerprint
discipline (`netlify/server/runs.ts`'s `computeRequestFingerprint`
pattern — a SHA-256 hex digest over canonical, deterministically
normalized fields, never raw arbitrary content) over, at minimum:

- the deterministically normalized dossier text (hashed, not stored —
  Decision 13's no-retention policy is unaffected: only the fingerprint
  persists, never the content it was computed from);
- `source.kind` where semantically relevant (a `.pdf` and a `.txt`
  that happen to normalize to identical text are still the same
  logical request once normalized — `kind` is included only if a
  future implementation decision finds it materially changes
  extraction semantics; the normalized text is the dominant input
  either way);
- `PACKAGE_EXTRACTION_PROMPT_VERSION`;
- the configured extraction model identity (`PACKAGE_EXTRACTION_MODEL_ID`
  or whatever application-owned extraction configuration changes call
  semantics).

**Privacy implication, stated honestly:** the fingerprint is a
one-way hash of normalized content plus small fixed application
configuration — it does not, by itself, reveal dossier content, but
(like any content hash) it *could* in principle be used to confirm a
guess at specific known content via a dictionary/rainbow-table-style
attack if an attacker already had many candidate dossiers to test
against a leaked fingerprint. This is an accepted, disclosed residual
risk of the fingerprint approach itself (identical in kind to
`POST /api/runs`'s existing `request_fingerprint` column, not a new
category of exposure this ADR introduces) — no raw or reversible
dossier content persists.

Locked semantics:

- **Initial endpoint**, same `extractionRequestId` + same fingerprint
  → idempotent replay: return the existing logical extraction's current
  state, no new provider call.
- **Initial endpoint**, same `extractionRequestId` + a *different*
  fingerprint → `409 IDEMPOTENCY_CONFLICT`, **zero provider calls** —
  mirrors `POST /api/runs`'s existing conflict behavior for a reused
  `client_request_id` with different semantic content exactly.
- **Retry endpoint**, resent source normalizes to a fingerprint that
  does **not** match the logical extraction's stored
  `request_fingerprint` → `409 IDEMPOTENCY_CONFLICT`, zero provider
  calls — the retry is rejected as not-the-same-logical-call, not
  silently accepted as a new attempt of something else.

### Atomic pre-spend claim — new this pass (independent review)

**Corrected this pass: `UNIQUE(extraction_request_id, attempt_number)`
alone is not sufficient if the provider call happens before the
attempt row is inserted/claimed.** Two concurrent requests could both
pass a read-only eligibility check, both call the provider (both
spend), and only then race on the unique insert — one loses the
insert, but both already spent. **Locked invariant: no OpenRouter/
provider call may begin until that specific provider attempt has been
atomically claimed in the database** — claim-then-spend, never
spend-then-claim.

Mechanism (a server-authoritative atomic operation — an RPC/transaction
consistent with the project's existing Supabase freeze/idempotency
discipline, e.g. `docs/adr/0002-participant-configuration-freeze.md`'s
`freeze_participant_configuration` pattern: preconditions checked and
the claiming insert performed together, inside one atomic operation,
with a caught `unique_violation` — not application-code-level
check-then-insert):

1. The caller (the initial-endpoint handler for `attempt_number = 1`,
   or the retry-endpoint handler for `attempt_number = 2`) resolves the
   route/pricing snapshot it intends to use (Decision 10) and computes
   that attempt's `estimated_cost_usd` **before** attempting the claim.
2. The claim operation, atomically:
   - for `attempt_number = 1`: creates `setup_extractions` (with
     `request_fingerprint`) if it does not already exist for this
     `extractionRequestId` (or verifies the fingerprint matches an
     existing one — mismatch aborts with `IDEMPOTENCY_CONFLICT` before
     any insert), then inserts the `attempt_number = 1` row with
     `status = 'CLAIMED'` and the fixed identity/pricing fields above;
   - for `attempt_number = 2`: verifies attempt #1 exists, is
     **terminal**, and is **retryable** (Decision 8); verifies the
     fingerprint match (above); re-runs Decision 9's retry-budget guard
     using attempt #1's real recorded spend; only then inserts the
     `attempt_number = 2` row with `status = 'CLAIMED'`;
   - relies on `UNIQUE(extraction_request_id, attempt_number)` to make
     the claiming insert itself the race-safe boundary: if a
     concurrent caller's claim already committed for the same
     `(extraction_request_id, attempt_number)`, this insert fails with
     `unique_violation`, caught and treated as "lost the claim," never
     as an application error.
3. **Only the caller that successfully wins the claim may proceed to
   call the provider.** A caller that loses the claim (or observes an
   already-`CLAIMED`/terminal row for that attempt number) returns the
   existing attempt's current state — `RUNNING`/`CLAIMED` if still in
   flight, or its terminal result if already resolved — and makes
   **zero** provider calls itself.
4. After the provider call resolves (success, or any failure category),
   the same caller that won the claim — identified by owning that
   specific attempt row — writes the **one** permitted status
   transition from `CLAIMED` to a terminal value, plus whatever
   telemetry the provider supplied (Decision 14). This is an `UPDATE`
   of a row this request alone owns (via the claim it already won),
   not a new insert — no further race is possible for that attempt
   number, since the `UNIQUE` constraint already guarantees only one
   claim could ever have succeeded.

### Ambiguous claim / Function failure — new this pass (independent review)

If a Function invocation dies after successfully claiming an attempt
(step 2 above) but before writing its terminal result (step 4), that
attempt row is left in `CLAIMED`/`RUNNING` indefinitely. Locked minimum
safe behavior, **fail closed rather than silently retrying**:

- A duplicate request for the same attempt (a client retry of its own
  in-flight call, or a concurrent request) that observes a
  `CLAIMED`/`RUNNING` row returns that in-progress/unknown state — it
  never attempts a second provider call using the same attempt number.
- **Retry eligibility (Decision 8) requires attempt #1 to be
  *terminally* classified** — a `CLAIMED`/`RUNNING` row, however old,
  does **not** count as "terminal and retryable." A stuck `RUNNING`
  attempt #1 therefore blocks the retry endpoint entirely until it is
  reconciled — this is intentional fail-closed behavior, not a defect.
- **Stale-claim reconciliation is explicitly deferred, not solved in
  this planning pass.** A future, separately reviewed mechanism (e.g. a
  reconciliation job that checks the provider's own request-id status,
  or a bounded staleness timeout after which a `CLAIMED` row is
  reclassified to a stable terminal `TIMEOUT`-like state) is needed
  before this can be considered production-complete — recorded as an
  Open Decision below, not silently assumed solved.
- Unknown billing telemetry from an unresolved `CLAIMED` attempt
  remains `null` — never fabricated as zero, never assumed successful
  or failed without evidence.

### Idempotency summary

- **Maximum provider attempts per logical call: 2** — enforced
  structurally (there is no third endpoint call this contract defines,
  and `attempt_number` has no valid value beyond 2).
- An accidental exact-duplicate submission to the **initial** endpoint
  (double-click, a client network retry re-sending the identical
  `extractionRequestId` and the same source) is idempotent via the
  fingerprint-matched claim above — mirroring `POST /api/runs`'s
  `client_request_id` unique-constraint pattern exactly, now realized
  through the same atomic claim mechanism.
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
- **Resource exhaustion**: bounded by the 4 MiB
  `SMART_EXTRACTION_PDF_MAX_RAW_BYTES` raw-byte cap (Decision 3), a
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
  -> [client-side type/size check]
  -> read-only preflight quote (POST /api/setup-extractions/preflight,
     NEW this pass, Decision 9/19) -- shows eligibility, resolved model/
     endpoint, conservative maximum cost, zero spend
  -> explicit "Confirm & Extract" (only now does the billable initial
     POST fire -- the browser's earlier quote is never trusted as
     authoritative; the server reruns the same guard immediately before
     spend, Decision 9)
  -> Extracting (progress state)
  -> Extraction Review (staged preview)
       - unresolved fields visibly highlighted (from warnings, Decision 6)
       - all fields editable
       - warning summary visible
       - source filename/type visible
       - extraction model/version visible at a secondary/collapsible
         audit-detail level (not primary UI real estate)
       - estimated cost (from the preflight quote) and actual cost
         (post-attempt) shown, clearly separate from the future
         Tribunal run cost
       - "Apply extracted draft" / "Cancel" (Decision 12)
  -> existing setup Review (unchanged M5/M6 screen, now populated)
  -> existing normal edit/validation (unchanged)
  -> explicit Convene later (unchanged; never automatic)
```

Failure state: the exact Decision 16 error code surfaced in
user-facing language, with a "Retry" affordance when the failure is
retryable (Decision 8) and a clear "edit and try again" path otherwise.
A Retry resubmits the same dossier content the user already
provided (Decision 15) — the UI does not need to prompt the user to
re-upload/re-paste; it resends what it already has client-side. No
automatic navigation into deliberation at any point.

## Decision 19 — API contract

```text
POST /api/setup-extractions/preflight                    -- read-only quote, zero provider calls -- NEW this pass
POST /api/setup-extractions                               -- billable, initial attempt only
POST /api/setup-extractions/{extractionRequestId}/retry   -- billable, explicit retry only
```

**Three endpoints — corrected this pass (independent review) to add
the read-only quote endpoint (Decision 9) and to fix the retry
endpoint's body (Decision 15).** The retry is a **separate, explicit**
resource action, not a field on the initial request, so the server
(never the client) determines attempt eligibility from persisted
state.

Chosen over `/api/extractions` for consistency with the existing
`setup`/`TribunalSetupDraft` naming already used throughout
`src/schemas/tribunalSetup.ts`.

**Preflight request** (new this pass) — identical `source` shape to the
initial request, no `extractionRequestId` (a quote is not itself a
logical call and creates no persisted state):

```ts
{
  source:
    | { kind: "text"; text: string }
    | { kind: "file"; filename: string; contentBase64: string };
}
```

Preflight response — sanitized, informational only, no
`createChatCompletion`/provider-inference call made:

```ts
{
  eligible: boolean;
  configuredModelId: string | null;
  canonicalModelId: string | null;
  providerEndpointTag: string | null;   // exact resolved endpoint, audit display only
  conservativeMaxCostUsd: string;       // Decimal string, Decision 9's two-attempt worst case
  hardCeilingUsd: "0.50";
  blockedReasonCodes: <Decision 16 codes>[];
  pricingObservedAt: string | null;     // ISO timestamp, ADR 0003 Decision 9 semantics -- never fabricated
}
```

**Initial request** (JSON body, matching the existing Netlify Function
JSON-body convention this repository already uses for imports/runs —
no multipart parsing introduced):

```ts
{
  extractionRequestId: string; // uuid, Decision 15 -- always creates attempt #1, never a client-declared attempt number
  source:
    | { kind: "text"; text: string }
    | { kind: "file"; filename: string; contentBase64: string };
}
```

**Retry request — corrected this pass (independent review, Decision
15): the source must be resent, not omitted.** The prior version
required no body at all, which was impossible under the
never-persist-dossier-content policy — attempt #2 needs the same
content to construct its request, and the server has nowhere to read
it back from:

```ts
POST /api/setup-extractions/{extractionRequestId}/retry
{
  source:
    | { kind: "text"; text: string }
    | { kind: "file"; filename: string; contentBase64: string };
}
```

The server re-validates/re-normalizes/re-extracts the resent source
exactly as the initial call does, and requires it to reproduce the
logical extraction's stored semantic fingerprint (Decision 15) before
proceeding — the client cannot retry with different content. The
server derives `attempt_number = 2` itself after validating the
existing attempt #1 is in a **terminal**, retryable state (Decision
15) — never a client-declared attempt number.

Response (200, mirroring `runPreflight`'s pattern of a body-level
status rather than always using HTTP error codes for domain-level
outcomes), identical shape from both billable endpoints:

```ts
{
  status: "success" | "needs_review"; // "needs_review" covers both
                                       // EXTRACTION_INCOMPLETE and
                                       // EXTRACTION_AMBIGUOUS (Decision 16) --
                                       // the specific derived status and the
                                       // full warning list live in `warnings`/`attempt`
  draft: {...};
  warnings: [...];
  attempt: {...};      // this attempt's setup_extraction_attempts row (Decision 13)
}
  | { status: "blocked" | "failed"; errorCode: <Decision 16 hard-failure code>; message: string; attempt?: {...} }
```

400 for request-shape validation failures (missing/malformed fields);
409-class (`IDEMPOTENCY_CONFLICT`) for a fingerprint mismatch on either
billable endpoint (Decision 15), or a retry call with no eligible
attempt to retry; 502 for `PROVIDER_UNAVAILABLE`, mirroring
`preflightErrorResponse`'s existing `ServerConfigError`/`ProviderError`
→ 502 mapping exactly.

**Maximum request size — corrected this pass (independent review):**
bounded by `SMART_EXTRACTION_PDF_MAX_RAW_BYTES` (4 MiB, Decision 3)
plus ~33% base64 inflation ≈ 5.33 MiB, comfortably under the reverified
6 MB buffered-payload limit (Decision 20) with real headroom for the
JSON envelope, filename, and idempotency metadata. This is no longer a
deferred implementation-time verification item — both the request-size
and Function-timeout numbers are now grounded in current official
Netlify documentation (Decision 20).

Synchronous, one Function, no Background Function — each endpoint call
is exactly one provider attempt (Decision 8); nothing here demands
asynchronous execution.

## Decision 20 — Netlify Function limits: reverified against current official documentation

**Corrected this pass (independent review) — reverified directly**
against Netlify's current official documentation (`docs.netlify.com`,
fetched in this task, not recalled from training data) immediately
before locking Decisions 3/8/19 above:

| Limit | Current documented value | Configurable |
|---|---|---|
| Synchronous Function execution time | 60 seconds | No |
| Buffered request/response payload | 6 MB | No |
| Effective binary request payload (after ~30% base64 inflation) | ≈4.5 MB | No |

These are the values this ADR now plans against directly, not deferred
to implementation time:

- `SMART_EXTRACTION_PDF_MAX_RAW_BYTES = 4 MiB` (Decision 3) → ≈5.33 MiB
  base64-encoded, under the 6 MB buffered-payload limit with headroom
  for the JSON envelope (deliberately below the 4.5 MB
  effective-binary-limit number, which alone would leave no envelope
  headroom).
- `PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS = 45_000` (Decision 8), inside
  the 60-second Function execution ceiling, leaving real bounded
  headroom for the rest of the Function's work in the same invocation.
- Decision 8/15's "one provider attempt per HTTP request, retry is a
  separate explicit endpoint call" remains the structural safeguard —
  even with these now-confirmed numbers, it guarantees no single
  Function invocation ever needs more than one 45-second provider
  attempt inside the 60-second ceiling, with no dependency on these
  numbers never changing in the future.

If Netlify's documented limits change materially before implementation,
these three numbers are the ones to re-derive — the *structural* design
(bounded-size raw uploads, one attempt per request/Function invocation,
a provider timeout with real headroom under the Function ceiling) does
not need to change merely because the exact limit values do.

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
  `EXTRACTION_HARD_CEILING_USD` as the **logical-call** ceiling
  (Decision 9 — a test asserting it is not treated as per-attempt);
  the retry-budget guard using actual attempt-#1 spend + conservative
  attempt-#2 maximum; unknown pricing; endpoint pinning; a test
  asserting extraction eligibility is computed independently of
  `classifyPriceTier`/Tribunal-tier labels (Decision 9's corrected
  semantics).
- **Request-size boundary — new this pass (independent review,
  Decision 3)**: a `.pdf` fixture at exactly
  `SMART_EXTRACTION_PDF_MAX_RAW_BYTES` (accepted); one byte over
  (rejected, `FILE_TOO_LARGE`); the resulting base64-encoded request
  body size confirmed to stay under Netlify's reverified 6 MB buffered
  payload limit (Decision 20) with real envelope headroom.
- **Retry authority — new this pass (independent review, Decision
  15)**: an initial request cannot create `attempt_number = 2`; a
  retry call with no prior attempt is rejected; a retry call after a
  successful or terminally-non-retryable attempt #1 is rejected;
  simulated concurrent duplicate retry calls result in exactly one
  `attempt_number = 2` row (`UNIQUE(extraction_request_id,
  attempt_number)` enforced, not merely assumed).
- **Output-cap/schema boundary — new this pass (independent review,
  Decision 11)**: a fixture at the exact formally-computed worst-case
  schema shape, using only `safeExtractionText`-legal characters (all
  fields maxed, 3-byte-UTF-8 characters), is representable within
  `EXTRACTION_OUTPUT_CAP_TOKENS`; a test proving the *previous*
  12,000-token cap would have rejected that same valid fixture (the
  regression this correction fixes); a test proving a raw C0 control
  character (e.g. `\x01`) and a lone/unpaired surrogate are both
  rejected by `safeExtractionText`, demonstrating why the 3-byte bound
  is now actually true.
- **Retry input / semantic fingerprint — new this pass (deeper
  independent review, Decision 15)**: a retry call with a `source` that
  normalizes to the *same* fingerprint as the stored logical
  extraction succeeds; a retry call whose resent `source` normalizes
  to a *different* fingerprint is rejected with
  `409 IDEMPOTENCY_CONFLICT` and makes zero provider calls; an initial
  call reusing an `extractionRequestId` with matching content is an
  idempotent replay; an initial call reusing an `extractionRequestId`
  with different content is rejected the same way.
- **Atomic claim / concurrency — new this pass (deeper independent
  review, Decision 15)**: two simulated concurrent initial requests for
  the same `extractionRequestId` result in exactly one provider call
  (the loser observes the winner's claimed/terminal state and never
  calls the provider itself); the same for two concurrent retries of
  the same logical extraction; a test asserting the claim insert
  happens (and can be observed as `CLAIMED`) *before* the fake
  provider is ever invoked, not after.
- **Ambiguous claim / stale `CLAIMED` — new this pass (deeper
  independent review, Decision 15)**: an attempt stuck in
  `CLAIMED`/`RUNNING` (simulating a Function that died mid-attempt)
  blocks the retry endpoint (fails closed, not treated as
  "terminal and retryable"); a duplicate request against that same
  attempt returns the in-progress state and makes no provider call.
- **Preflight endpoint — new this pass (deeper independent review,
  Decision 9/19)**: `POST /api/setup-extractions/preflight` makes zero
  `createChatCompletion` calls under any fixture; its response shape
  matches what Decision 19 defines; a test confirming the billable
  initial endpoint reruns its own authoritative budget guard even when
  called with a stale/mismatched prior quote (never trusting the
  browser's earlier preflight response as authoritative).
- **Attempt telemetry on application-level failure — new this pass
  (deeper independent review, Decision 14)**: a fake-provider response
  that succeeds at the HTTP/usage level but fails schema validation
  (`INVALID_STRUCTURED_OUTPUT`) still records non-null actual
  tokens/cost/provider-request-id on that attempt's row.

New test files/locations (planned, not created): `netlify/server/
extraction/` mirroring `netlify/server/openrouter/`'s existing
per-concern file layout (schema, pdf extraction, economics,
idempotency, atomic-claim/concurrency, the API handlers).

## Decision 23 — Live gate policy: timed to the future implementation PR, not this planning PR

**Corrected this pass (independent review) — the previous wording
("before this PR merges") was impossible**: PR #14 is planning-only and
deliberately contains no extraction API, no extraction prompt, no
extraction schema implementation, no `pdfjs-dist` dependency, no
extraction audit migration, and no real extraction code at all — there
is nothing in this PR a live smoke could exercise.

Locked sequencing:

```text
Planning PR #14 (this PR)
  -> independent review of this ADR
  -> merge PLANNING ONLY -- no live extraction performed

THEN, as a separate, later, explicitly authorized task:
  -> M7A IMPLEMENTATION authorized
  -> feature implemented against this ADR
  -> static tests (fixture categories, Decision 22)
  -> integration tests
  -> reviewed dev-only Supabase migration applied, if the
     setup_extractions/setup_extraction_attempts tables are needed
  -> explicit human authorization immediately before any real call
  -> ONE low-cost/free real extraction smoke (below)
  -> independent live-gate audit
  -> M7A IMPLEMENTATION PR merge
```

**The live extraction smoke is mandatory before the future M7A
*implementation* PR merges — never before this planning PR merges.**
Its own required properties are unchanged by this correction:

- A synthetic, clearly-fictional, non-sensitive test dossier (no real
  course/private data).
- A route whose extraction-specific conservative cost estimate is
  `$0.00` (a genuinely zero-priced model), preferred if one is eligible
  at smoke time — **not** "a `FREE`-tier route" in the Tribunal-tier
  sense (Decision 9's corrected semantics: extraction eligibility is
  never inferred from the Tribunal tier label).
  `EXTRACTION_HARD_CEILING_USD` remains the hard safety backstop
  regardless of the target route's price.
- Expected result: schema-only structured output validated end to end;
  the real `setup_extractions`/`setup_extraction_attempts` audit path
  exercised (Decision 13); no real dossier content persisted beyond the
  bounded audit fields (Decision 14).
- Explicit human authorization required immediately before the call —
  the same standing rule this project has followed for every prior
  live OpenRouter interaction.
- **Not performed by this planning task**, and not performable by it —
  the implementation this smoke would exercise does not yet exist.

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

1. Exact `case_id` relationship for `setup_extractions` (standalone vs.
   nullable FK back-filled once a case exists) — a migration design
   detail, not a product-behavior question.
2. Exact recommended PDF page-count guard and extraction wall-clock
   timeout values — bounded by `NORMALIZED_DOSSIER_TEXT_MAX_CHARS`
   downstream regardless of the exact number chosen.
3. Exact `EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS` value — computed
   from the real extraction system prompt's byte length once drafted
   (formula locked in Decision 11; the prompt text does not exist
   yet).
4. `pdfjs-dist`'s current exact version/security posture — verify at
   dependency-addition time, per `AGENTS.md`'s standing
   dependency-addition rule.
5. How many real-catalog OpenRouter models — especially genuinely
   free/cheap ones — actually support `max_completion_tokens >=
   EXTRACTION_OUTPUT_CAP_TOKENS` (65,000). This is an empirical
   question the live-gate smoke (Decision 23) and real `GET
   /api/models` discovery will answer; if the real-catalog eligible-route
   set turns out to be impractically small, that is a genuine finding
   for a future, separately reviewed correction — not something this
   ADR can resolve without live data, and not silently worked around by
   quietly lowering the output cap back toward an unproven "realistic"
   guess. (Plausible candidates were cited during review as illustrative
   examples, Decision 11 — capability is not treated as wholly unknown
   at the model level — but exact live eligibility remains this
   implementation/live-metadata gate, not something this planning-only
   task independently reverified.)
6. **New this pass (deferred, Decision 15): stale-`CLAIMED`-attempt
   reconciliation.** If a Function invocation dies after claiming a
   provider attempt but before writing its terminal result, that
   attempt row remains `CLAIMED`/`RUNNING` indefinitely under this
   plan's fail-closed design — it correctly blocks further action
   (never licenses another provider call, never counts as "terminal and
   retryable" for a subsequent retry) but nothing in this ADR yet
   reconciles it back to a stable terminal state so the user isn't
   permanently stuck. A future, separately reviewed mechanism (e.g. a
   provider-request-id status check, or a bounded staleness timeout
   that reclassifies an old `CLAIMED` row to a stable `TIMEOUT`-like
   terminal state) is needed before this is production-complete. Fail
   closed is the correct interim behavior, not a placeholder for
   "solved" — this item is genuinely open, not merely deferred detail.
7. **New this pass:** whether `source.kind` should be included in the
   semantic fingerprint (Decision 15) at all, given the normalized text
   is the dominant, already-included input and two different source
   kinds could legitimately normalize to identical text — an
   implementation-time judgment call within the fingerprint design
   Decision 15 already locks, not a decision this ADR needs to force
   now.

**Resolved this pass (previously open, now grounded in reverified
current evidence):** the exact Netlify Function synchronous-execution
(60s) and buffered-payload (6 MB / ≈4.5 MB effective binary) limits —
see Decision 20.
