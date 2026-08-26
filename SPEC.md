# The Tribunal — System Specification

> **Course:** Agentic Software Engineering (ASE-26)
> **Status:** V1 engineering contract
> **Purpose:** Define precise, testable product behaviour before implementation.

## 0. Document Role and Precedence

`INTENT.md` is the source of truth for **why** The Tribunal exists and for durable product direction.

This file defines **what observable behaviour must be true**: inputs, outputs, states, failure behaviour, limits, execution rules, and acceptance criteria.

`ARCHITECTURE.md` defines **how the system is structurally implemented**. `AGENTS.md` defines standing operating rules for coding agents.

If this specification appears to conflict with `INTENT.md`, implementation must stop until the conflict is resolved. Architecture may refine implementation details, but may not weaken a requirement in this file without an approved specification change.

This is a living specification. Intended behaviour changes here before code changes when practical.

---

## 1. Product Goal

The Tribunal makes AI deliberation observable.

A user submits one disputed case, configures seven distinct AI participants, and observes how opposing advocates argue and how independent judges reach reasoned verdicts. The application must also expose the token, latency, and cost economics of the deliberation.

The application is educational and demonstrative. It has no legal authority and must not present itself as legal advice.

---

## 2. Canonical Terminology

### 2.1 Charge Sheet

A Charge Sheet has exactly three authoritative fields:

1. **Defendant**
2. **Act**
3. **Exact Question**

The application may serialize those fields for prompts, but they remain distinct application data.

### 2.2 Participant

One configured AI role in one run. V1 has exactly seven participants:

- Advocate PRO 1
- Advocate PRO 2
- Advocate CON 1
- Advocate CON 2
- Judge 1
- Judge 2
- Judge 3

### 2.3 Logical model call

The required AI execution for one participant. A successful no-retry run has exactly seven logical model calls.

Retries are attempts of an existing logical call; they do not create additional participants.

### 2.4 Provider attempt

One actual outbound request to OpenRouter for one logical call. Each logical call may have one initial attempt and at most one retry.

### 2.5 Run

One complete attempt to deliberate one configured case.

### 2.6 Tribunal Package

A Tribunal Package is one structured file that can populate a complete setup draft:

- canonical Charge Sheet
- PRO Advocate 1 profile
- PRO Advocate 2 profile
- CON Advocate 1 profile
- CON Advocate 2 profile
- Judge 1 profile
- Judge 2 profile
- Judge 3 profile

It does not determine participant count, participant role, advocate side, execution mode, model assignment, prompt version, retry policy, security policy, or economics policy. Those remain application-owned.

Milestone 5 supports a strict deterministic Tribunal Package format using exactly these fixed seat identifiers:

- `PRO_1`
- `PRO_2`
- `CON_1`
- `CON_2`
- `JUDGE_1`
- `JUDGE_2`
- `JUDGE_3`

The section identifier determines which fixed seat is populated. A package must not include arbitrary role or side assignment.

### 2.7 Tribunal Setup Draft

A Tribunal Setup Draft is normalized application data produced by manual entry, individual imports, or a Tribunal Package import before a run exists.

It contains the canonical Charge Sheet and exactly seven fixed participant draft entries. Each participant draft may include optional `profileName`, personality text, personality source metadata, and safe import source metadata.

The draft is editable and reviewable. It is not a frozen run configuration.

---

## 3. Charge Sheet Input

### 3.1 Manual entry

The manual form must collect all three fields.

After trimming surrounding whitespace:

- Defendant: **1–200 characters**
- Act: **1–6000 characters**
- Exact Question: **1–1000 characters**

An invalid field prevents run creation and identifies the offending field to the user.

Required-field validation is deterministic and must not use an LLM.

### 3.2 Charge Sheet file import

V1 supports:

- `.txt`
- `.md`

Requirements:

- UTF-8 text only
- maximum raw file size: **64 KiB**
- deterministic parsing
- no LLM call for parsing

The file must contain exactly one of each marker:

```text
DEFENDANT:
ACT:
QUESTION:
```

Each section must contain non-empty content after trimming. Parsed content must also satisfy the canonical field limits.

The following must be rejected visibly:

- unsupported extension/type
- invalid UTF-8
- oversized file
- missing required marker
- duplicated required marker
- empty required section
- parsed field exceeding its limit

The raw uploaded file does not need to be retained after successful parsing in V1.

### 3.3 Full Tribunal Package import

Milestone 5 supports strict structured Tribunal Package imports:

- `.txt`
- `.md`
- UTF-8 text only
- maximum raw package size: **192 KiB**
- deterministic parsing
- no LLM call for parsing

Canonical strict package grammar:

```text
TRIBUNAL_PACKAGE_V1

[CHARGE_SHEET]

DEFENDANT:
<text>

ACT:
<text>

QUESTION:
<text>

[PRO_1]

PROFILE_NAME:
<optional text>

PERSONALITY:
<text>

[PRO_2]

PROFILE_NAME:
<optional text>

PERSONALITY:
<text>

[CON_1]

PROFILE_NAME:
<optional text>

PERSONALITY:
<text>

[CON_2]

PROFILE_NAME:
<optional text>

PERSONALITY:
<text>

[JUDGE_1]

PROFILE_NAME:
<optional text>

PERSONALITY:
<text>

[JUDGE_2]

PROFILE_NAME:
<optional text>

PERSONALITY:
<text>

[JUDGE_3]

PROFILE_NAME:
<optional text>

PERSONALITY:
<text>
```

A package is valid only when:

- package header exists exactly once
- required sections exist exactly once
- no duplicate required section exists
- no unknown participant seat or unknown structural section is accepted
- Charge Sheet obeys canonical field limits
- each of the seven `PERSONALITY:` values is non-empty after trimming and at most 4000 normalized characters
- optional `PROFILE_NAME:` values are at most 120 normalized characters
- raw package size is at most 192 KiB
- UTF-8 is valid
- extension is `.txt` or `.md`

Unsupported structural fields, including model, provider, execution mode, prompt, pricing, retry, or budget fields, fail closed.

Package import is atomic. Either the entire normalized package validates and can populate the setup draft, or the current setup remains unchanged with specific visible errors.

Package import never starts Tribunal execution and never spends the seven Tribunal participant calls.

---

## 4. Participant Personality Input

Every participant has independent behavioural/personality context.

Personality may be supplied by:

- manual text/paste
- `.txt`
- `.md`

Requirements:

- UTF-8 only
- maximum raw personality file size: **16 KiB**
- normalized text must be non-empty
- normalized text maximum: **4000 characters**

Personality is behavioural context, not merely a label. It supplements but never replaces the participant's fixed role instructions.

User-provided personality text is untrusted input. It cannot change participant identity, advocate side, output contract, cost/security rules, or backend authority.

### 4.1 Participant profile name

Each participant may also have an optional `profileName`.

Requirements:

- user supplied or import supplied
- trimmed
- maximum **120 characters**
- plain untrusted text
- purely human-facing metadata
- does not define or change the participant role

The fixed application seat remains authoritative and visible. For example, `PRO I - Example Person` may be shown, but the imported name never converts a PRO advocate into a CON advocate or a judge into an advocate.

Milestone 6 persists/freezes this field in full participant configuration.

---

## 5. Participant Configuration

### 5.1 Advocates

Every run contains exactly:

- 2 PRO advocates
- 2 CON advocates

Users cannot add/remove advocates or change their assigned side in V1.

Each advocate receives:

- the same canonical Charge Sheet
- fixed side (`PRO` or `CON`)
- that advocate's personality
- version-controlled base advocate instructions
- assigned model according to execution mode

### 5.2 Judges

Every run contains exactly three judges.

Each judge receives:

- the original canonical Charge Sheet
- all four validated advocate speeches
- that judge's personality
- version-controlled base judge instructions
- assigned model according to execution mode

A judge must never deliberate using only a subset of the intended four speeches.

---

## 6. Strict Model Output Contracts

Model output is untrusted until parsed and validated server-side.

V1 does **not** accept arbitrary prose as machine-consumed output and does not use regex/keyword guessing to convert prose into valid application data.

### 6.1 Advocate response

A successful advocate response must parse as a JSON object containing:

```json
{
  "speech": "..."
}
```

`speech` must be a non-empty string after trimming.

Malformed JSON, missing `speech`, a non-string `speech`, or an empty `speech` is an invalid attempt.

Maximum requested advocate output: **1000 output tokens per attempt**.

### 6.2 Judge response

A successful judge response must parse as a JSON object containing:

```json
{
  "verdict": "GUILTY",
  "reasoning": "..."
}
```

`verdict` must be exactly one of:

- `GUILTY`
- `NOT_GUILTY`

`reasoning` must be a non-empty string after trimming.

Malformed JSON, a missing/unsupported verdict, or missing/empty reasoning is an invalid attempt.

A prose sentence containing the word “guilty” is not a valid verdict response.

Maximum requested judge output: **1200 output tokens per attempt**.

Additional JSON properties may be ignored or rejected by the implementation schema, but they must never change the meaning of required fields.

---

## 7. Execution Modes

### 7.1 Shared-Model Mode

One selected OpenRouter model is used for all seven participants.

Participants remain distinct through role, side, personality, and prompt context.

### 7.2 Separate-Model Mode

Each participant may be assigned an individual OpenRouter model.

The orchestration, validation, retry, economics, and failure rules are identical to Shared-Model Mode.

### 7.3 Agent Execution

A genuinely agentic execution mode remains unresolved course scope and is not a V1 acceptance criterion.

Ordinary model calls must not be renamed or marketed as “agents.” The architecture should avoid blocking a later strategy addition, but V1 must not contain speculative fake-agent complexity.

---

## 8. OpenRouter Requirement

OpenRouter is the required V1 model gateway.

Exact model IDs are runtime configuration, not permanent product requirements, because availability and pricing can change.

The system may expose only models that meet the capabilities needed for the current execution contract, including reliable structured output and sufficient context capacity.

No silent paid-model fallback is permitted when the selected model/provider fails.

---

## 9. Deliberation Orchestration

A successful Tribunal run has two dependency phases.

### 9.1 Phase A — Advocates

The four advocate logical calls **must be initiated as one concurrent phase**.

The application must not intentionally serialize Advocate 1 → Advocate 2 → Advocate 3 → Advocate 4.

Low-level provider/runtime limits may affect actual network scheduling, but the application must express the four advocates as independent concurrent work.

### 9.2 Advocate barrier

Judge execution must not begin until all four advocate outputs have passed server-side structured validation.

### 9.3 Phase B — Judges

After the advocate barrier succeeds, the three judge logical calls **must be initiated as one concurrent phase**.

The application must not intentionally serialize the judges.

Every judge receives the same four validated speeches.

### 9.4 Call geometry

Successful no-retry run:

- 4 advocate logical calls
- 3 judge logical calls
- **7 logical calls total**

There is no required eighth LLM call.

---

## 10. Retry and Timeout Policy

### 10.1 Retry limit

Each logical participant call may have at most:

- 1 initial provider attempt
- 1 retry

Maximum theoretical provider attempts per run: **14**.

A retry may occur only for a retryable failure such as:

- transient provider/network failure
- application-enforced timeout
- malformed/invalid structured model output

Do not retry:

- invalid user input
- unsupported upload
- invalid configuration
- budget preflight rejection
- missing/unsafe pricing information

A retry must not silently change participant, side, personality, selected model, or role instructions.

### 10.2 Timeout

Every provider attempt must have an **application-enforced timeout no greater than 60 seconds**.

Architecture may choose a shorter timeout to fit runtime constraints.

When the timeout is reached before a valid response is accepted, the attempt is timed out and may consume the one permitted retry if retry and budget rules allow.

---

## 11. Failure Behaviour

Failure must look like failure, never like a verdict.

### 11.1 Advocate terminal failure

If an advocate's second permitted attempt also fails:

- that logical call is terminally failed
- the run becomes `FAILED`
- judge phase must not start

Other completed advocate outputs may remain available for diagnostics, but the run is not a valid Tribunal result.

### 11.2 Judge terminal failure

If a judge's second permitted attempt also fails:

- that logical call is terminally failed
- the run becomes `FAILED`
- no majority is produced

A majority may not be calculated from one or two judges.

### 11.3 Forbidden failure defaults

No error path may silently become:

- `GUILTY`
- `NOT_GUILTY`
- empty verdict
- fabricated speech/reasoning
- `COMPLETED`

---

## 12. Deterministic Majority

Majority calculation occurs only after exactly three valid judge verdicts exist.

It is ordinary deterministic application code.

Examples:

- GUILTY / GUILTY / NOT_GUILTY → GUILTY
- GUILTY / NOT_GUILTY / NOT_GUILTY → NOT_GUILTY
- three identical verdicts → that verdict

No model call may calculate, reinterpret, summarize, or “confirm” the majority.

---

## 13. Full Protocol

V1 resolves protocol composition as deterministic assembly.

The full protocol must include or reference:

- canonical Charge Sheet
- execution mode
- frozen participant configuration
- model assignment and prompt version per participant
- four advocate speeches
- three judge verdicts
- three judge reasonings
- deterministic majority
- model-call economics/audit data

Protocol generation must not call an LLM.

Reopening a stored protocol must not rerun models.

---

## 14. Run States

The product must distinguish at least these user-observable meanings:

- `DRAFT`
- `READY`
- `ADVOCATES_RUNNING`
- `JUDGES_RUNNING`
- `COMPLETED`
- `FAILED`
- `BLOCKED_BUDGET`

The internal enum may add substates (for example retrying), but it may not collapse failures or budget rejection into a completed result.

A run becomes immutable in its participant/model/prompt configuration once execution starts.

---

## 15. Economics and Audit Requirements

### 15.1 Successful provider attempt

Every successful attempt must persist:

- participant identity
- role
- side if applicable
- provider/model ID
- attempt number
- successful status
- input tokens
- output tokens
- total tokens
- pricing snapshot sufficient to audit the calculation
- actual OpenRouter cost when supplied
- derived comparison cost where useful
- latency
- provider request/generation identifier when available

A successful-looking response that cannot support reliable V1 usage/cost accounting must not silently yield a `COMPLETED` run with unknown economics.

### 15.2 Failed provider attempt

Failed attempts may legitimately lack usage or cost telemetry.

When unavailable:

- unavailable fields remain explicitly unavailable/null
- the system must not fabricate zero
- failure/error category is recorded
- any usage/cost data that was returned is retained

### 15.3 Run aggregation

The system deterministically aggregates:

- logical call count
- provider attempt count
- total input tokens
- total output tokens
- total tokens
- advocate cost
- judge cost
- total model cost
- timing summary

Pricing used for historical calculations must remain auditable after model prices change.

---

## 16. Hard Cost Policy

Maximum allowed model spend for one run:

```text
$5.00 USD
```

This includes retries.

The desired operating cost is substantially lower and should favor free or very-low-cost models.

### 16.1 Preflight

Before run execution, authoritative server code must conservatively estimate worst-case model spend for the selected configuration using current known pricing, bounded input exposure, output caps, seven logical calls, retry exposure, and an explicit safety margin.

If pricing cannot be bounded reliably, the configuration is not eligible for V1 execution.

If conservative preflight exceeds `$5.00`, execution is blocked as `BLOCKED_BUDGET` before any model call.

### 16.2 Runtime guard

Before each provider attempt, including retries, the backend must ensure the attempt cannot intentionally violate the remaining run budget under the current conservative accounting policy.

No silent paid fallback is permitted.

If provider billing unexpectedly exceeds the accepted bound after money has already been spent, remaining calls stop and the run is marked as an explicit budget anomaly/failure. The system must not conceal the overrun.

Detailed formulas and source precedence live in `docs/economics.md`.

---

## 17. Idempotency and Duplicate Spend

Starting a run is a cost-bearing operation and must be idempotent.

Repeated browser submissions caused by double-click, retry, refresh, or network ambiguity must not create two paid Tribunal runs for one accepted start request.

The backend must use a stable client/request idempotency identifier or equivalent deterministic uniqueness control.

A background worker must claim a run atomically so duplicate worker invocation cannot execute the same run twice.

---

## 18. Persistence and History

V1 is a single-tenant educational/demo application. It does not require accounts or login.

Persist:

- normalized cases
- run configuration snapshots
- participant configurations
- attempts and economics
- speeches
- verdicts/reasoning
- deterministic protocol
- enough failure data to diagnose failed runs

The History/Past Cases experience must reopen stored completed results without model calls.

Because the V1 history is not private per-user, the UI must disclose that submitted cases may be retained and visible in demo history and must warn users not to submit sensitive/private information.

Raw `.txt`/`.md` uploads do not need to be retained after successful normalization.

Milestone 5 persists basic normalized cases only. A stored case is not a completed Tribunal run and must not fabricate verdicts, speeches, model costs, execution status, or protocol data.

---

## 19. Smart Tribunal Package Extraction Future Scope

After OpenRouter infrastructure exists in Milestone 7 and before real Tribunal orchestration in Milestone 8, the project plans a future `M7A - Smart Tribunal Package Extraction` milestone.

M7A will allow a free-form complete Tribunal document to be transformed into the same normalized `TribunalSetupDraft`. Minimum planned input support:

- `.txt`
- `.md`
- text-extractable `.pdf`

PDF support belongs to M7A, not Milestone 5. Scanned-document OCR is not automatically included and requires a separate explicit scope decision.

The smart extraction flow is:

```text
Free-form document
  -> safe file validation
  -> deterministic text extraction
  -> one setup-time structured extraction model call
  -> strict schema validation
  -> application normalization
  -> Review
  -> human correction/confirmation
  -> explicit Convene Tribunal
  -> 7 Tribunal participant logical calls
```

The extraction call:

- is a setup/import operation before run creation
- is not one of the seven Tribunal participant logical calls
- does not create an eighth Tribunal participant
- receives no tools or privileged authority
- must use strict structured output
- must not assign models, roles, sides, prompts, pricing, or execution mode
- must permit unresolved/null fields rather than fabricate required data
- must surface incomplete or ambiguous extraction as needing review
- must never automatically start Tribunal execution
- must never hard-code a lecturer-provided dossier

Before M7A implementation, `docs/economics.md` must define explicit extraction spend, token/output, retry, telemetry, model eligibility, and display policy. No unbounded extraction call is permitted.

## 20. Browser / Server Authority Boundary

The browser handles interaction and presentation. It is not authoritative for security, cost, model execution, or persistence rules.

The browser must never receive:

- OpenRouter API key
- Supabase service-role/secret credential
- internal background-function secret
- other privileged server secrets

Trusted server-side code performs:

- authoritative input validation
- file parsing/validation
- budget enforcement
- OpenRouter requests
- structured model-output validation
- deterministic majority/protocol assembly
- authoritative persistence

Client validation may improve UX but does not replace server validation.

---

## 21. Prompt Requirements

Important runtime base prompts are version-controlled.

At minimum, use distinct base role instructions for:

- advocates
- judges

Participant personality is separately supplied context.

The prompt architecture must preserve fixed role/side/output/security instructions even when user-provided Charge Sheet/personality content contains adversarial instructions.

Runtime models receive no privileged arbitrary tools in V1.

Prompt changes are behavioural changes and require review like code changes.

---

## 22. UI Behaviour Requirements

The detailed design contract is `docs/ui-spec.md`. At minimum:

- setup follows Charge Sheet → Advocates → Judges → Review
- Review shows execution mode, models, 7-call geometry, conservative cost estimate, and `$5` policy
- Deliberation shows participant progress, not a blank spinner
- four advocate statuses are visible during advocate phase
- three judge statuses are visible after the barrier
- retry/failure is visible
- completed result prioritizes majority first
- all three judge votes are visible together
- judge reasoning follows
- advocate speeches follow
- economics detail follows
- History reopens stored results without rerun

A failed run must be visually and semantically distinct from a completed verdict.

---

## 23. Validation Strategy

### 22.1 Unit tests

Future unit tests must cover at least:

- Charge Sheet validation
- structured file parser
- personality validation
- advocate schema validation
- judge schema/verdict validation
- deterministic majority
- cost aggregation
- preflight/runtime budget rules
- run-state transitions
- idempotency/claim logic at the appropriate layer

### 22.2 Integration tests

Against a fake/mocked OpenRouter boundary, verify:

- four advocate requests are initiated as one concurrent phase
- judges do not begin before all four valid speeches
- three judge requests are initiated as one concurrent phase
- every judge receives all four speeches
- Shared-Model routing uses one model
- Separate-Model routing preserves all seven assignments
- strict malformed output fails/retries correctly
- retry limit holds
- phase failure rules hold
- economics aggregate correctly
- duplicate start does not create duplicate spend

### 22.3 End-to-end

Eventually verify:

```text
Create Case
→ Configure Participants
→ Review / Preflight
→ Start Tribunal
→ Observe Deliberation
→ View Result / Economics
→ Reopen from Past Cases
```

### 22.4 Deliberate failure scenarios

Test intentionally:

- provider timeout
- provider unavailable
- malformed advocate JSON
- prose advocate output
- empty speech
- malformed judge JSON
- prose containing GUILTY but not schema-valid
- unsupported verdict
- empty reasoning
- terminal advocate failure
- terminal judge failure
- invalid/oversized/non-UTF-8 upload
- missing/duplicate Charge Sheet marker
- strict Tribunal Package header, section, unsupported-field, and fixed-seat validation
- budget preflight block
- retry blocked by budget
- missing usage/cost telemetry on otherwise successful response
- duplicate start request
- duplicate background-worker invocation
- prompt-injection-like case/personality text

---

## 24. Known Pitfalls

- Fluent invalid model output can appear trustworthy.
- A keyword such as “guilty” in reasoning is not a verdict contract.
- A judge must never receive a partial advocate set.
- Sequential model calls create unnecessary latency.
- Retries can double economic exposure.
- Judges consume more context because they read all four speeches.
- Free model availability and pricing can change without a code release.
- Stale pricing can invalidate a budget estimate.
- A browser retry can accidentally double-spend without idempotency.
- Serverless/background delivery can occur more than once; workers must be claim-safe.
- Client-side validation is not authoritative.
- User personality text may attempt to override the role/output contract.
- Logging full cases/prompts can create unnecessary privacy exposure.
- A protocol generated by an extra LLM would silently change the seven-call economics.

---

## 25. Acceptance Criteria

These are target criteria, not claims that implementation already exists.

### CASE

- **CASE-001** — Every case requires Defendant, Act, and Exact Question.
- **CASE-002** — Valid manual input inside limits is accepted.
- **CASE-003** — Invalid/empty/oversized fields are rejected with field-specific feedback.
- **CASE-004** — Valid structured `.txt` input is parsed deterministically.
- **CASE-005** — Valid structured `.md` input is parsed deterministically.
- **CASE-006** — Unsupported, non-UTF-8, malformed, duplicate-marker, or oversized files are rejected visibly.
- **CASE-007** — File parsing performs no LLM call.
- **CASE-008** — Valid structured Tribunal Package `.txt` input atomically populates the Charge Sheet and seven fixed participant drafts.
- **CASE-009** — Valid structured Tribunal Package `.md` input atomically populates the Charge Sheet and seven fixed participant drafts.
- **CASE-010** — Invalid package header, missing/duplicate section, unknown section, unsupported structural field, invalid participant personality, invalid profile name, invalid Charge Sheet, unsupported extension, oversize, or non-UTF-8 package is rejected visibly without partially overwriting setup.
- **CASE-011** — Package import never changes participant count, participant role, advocate side, execution mode, model assignment, prompt version, security policy, or economics policy.
- **CASE-012** — Import never automatically starts Tribunal execution.

### PARTICIPANTS

- **PART-001** — Every run has exactly two PRO advocates.
- **PART-002** — Every run has exactly two CON advocates.
- **PART-003** — Every run has exactly three judges.
- **PART-004** — Users cannot add/remove participants or alter advocate sides in V1.
- **PART-005** — Every participant has independent non-empty personality context.
- **PART-006** — Manual and supported-file personality input both work within limits.
- **PART-007** — Optional participant `profileName` is editable/importable, limited to 120 characters, and remains human-facing metadata.

### CONFIG (Milestone 6)

- **CONFIG-001** — An accepted run persists exactly seven participant
  configurations, keyed by the seven fixed application participant
  identifiers; a duplicate, missing, or unknown key is rejected.
- **CONFIG-002** — Each participant's role and advocate side (where
  applicable) is fixed by its participant key and cannot be altered by
  user/import input.
- **CONFIG-003** — `profileName` is persisted per participant as optional
  human-facing metadata (`<=120` normalized characters) and never changes
  role, side, or seat.
- **CONFIG-004** — Shared-Model Mode persists the same `model_id` on all
  seven participant rows.
- **CONFIG-005** — Separate-Model Mode persists all seven independently
  configured `model_id` values.
- **CONFIG-006** — `model_id` is validated structurally before any
  persistence occurs: trimmed, `1`–`256` characters, no C0 control
  characters or `DEL`; no semantic/catalog check (that is Milestone 7's
  responsibility). A value failing this bound is rejected.
- **CONFIG-006A** — Personality source/filename combinations are
  cross-field validated at freeze time, not trusted from the browser:
  `manual` requires no filename; `individual_file`/`tribunal_package`
  require a safe `.txt`/`.md` filename (same safe-filename rules
  established for `cases` and imports in Milestone 5). A structurally
  inconsistent combination is rejected before persistence.
- **CONFIG-007** — Once accepted, a run's participant configuration is
  immutable: no application-facing role (including `service_role`, the
  only role application/server code ever authenticates as) has an
  `INSERT`, `UPDATE`, or `DELETE` grant on `tribunal_runs` or
  `participant_configs`; the one function that can write either table is
  not itself an update path.
- **CONFIG-008** — Accepting a run is idempotent on `client_request_id`; a
  repeated request with the same identifier **and** an unchanged
  normalized configuration returns the already-accepted run rather than
  creating a second one.
- **CONFIG-008A** — A repeated `client_request_id` whose normalized
  configuration has materially changed is rejected with `409` and a
  stable `idempotency_conflict` category; it never silently returns an
  unrelated run and never creates a second one.
- **CONFIG-009** — An accepted run references a valid, existing case,
  selected by an unambiguous request (an existing `caseId` or new case
  fields — never both). If the current setup's case was not already
  saved, Convene creates it using the same validated case-creation path as
  `Save Case`, as a step before — not inside the same atomic operation
  as — freezing the run; a case may remain persisted even if the
  subsequent freeze fails or conflicts.
- **CONFIG-009A** — Only `tribunal_runs` together with its exactly seven
  `participant_configs` rows is guaranteed atomic; a failed or conflicting
  freeze never leaves a partial run or a `participant_configs` row count
  other than 0 or 7 for that run.
- **CONFIG-009B** — A new-case Convene request is itself idempotent: a
  retry after a lost HTTP response (same `client_request_id`, same
  normalized new-case fields) reuses the same case row rather than
  creating a second one, and the request-level idempotency fingerprint
  (CONFIG-008) is computed from the case's normalized *content*, never
  from a generated case ID — so this retry correctly returns the existing
  run rather than a false `409`. A same-key request whose new-case
  content has materially changed is rejected `409 idempotency_conflict`
  without modifying the existing case.
- **CONFIG-010** — Accepting a run performs zero OpenRouter/model calls and
  produces no advocate speech, judge verdict, or economics data.
- **CONFIG-011** — A package-imported `TribunalSetupDraft` (Milestone 5)
  can be accepted/frozen through the same path as a manually-configured
  draft, with no additional constraints.
- **CONFIG-012** — A run's `prompt_version` is application-owned, never
  user/import-controlled; a run frozen with the pre-Milestone-7 prompt
  placeholder is a configuration-stage record only, and a later milestone
  must not execute it while that placeholder remains. `READY` means
  accepted/frozen configuration, not execution-eligible.
- **CONFIG-013** — A successful Milestone 6 Convene never navigates to, or
  displays content from, a mock/fabricated deliberation or result state.

### OUTPUT

- **OUT-001** — Advocate output must be schema-valid JSON with non-empty `speech`.
- **OUT-002** — Non-JSON/prose advocate output is rejected as an invalid attempt.
- **OUT-003** — Judge output must be schema-valid JSON with valid verdict and non-empty reasoning.
- **OUT-004** — Only `GUILTY` and `NOT_GUILTY` are accepted V1 verdicts.
- **OUT-005** — Non-JSON/prose judge output is rejected even if it contains a verdict keyword.
- **OUT-006** — Invalid model output cannot become application data without validation.
- **OUT-007** — Deterministic majority is correct for all three-vote binary combinations.
- **OUT-008** — Majority and protocol assembly use no additional LLM call.

### RUN

- **RUN-001** — Shared-Model Mode applies one selected model to all seven participants.
- **RUN-002** — Separate-Model Mode preserves participant-specific model assignments.
- **RUN-003** — Four advocates are initiated as one concurrent application phase.
- **RUN-004** — Judge phase does not start until all four advocate outputs validate.
- **RUN-005** — Three judges are initiated as one concurrent application phase after the barrier.
- **RUN-006** — Every judge receives all four validated speeches.
- **RUN-007** — A successful no-retry run has exactly seven logical model calls.
- **RUN-008** — A logical call receives at most one retry.
- **RUN-009** — Every provider attempt is bounded by an application timeout of no more than 60 seconds.
- **RUN-010** — Repeated start requests with the same idempotency identity do not create duplicate paid runs.
- **RUN-011** — Duplicate worker delivery cannot execute the same claimed run twice.

### FAILURE

- **FAIL-001** — Terminal advocate failure prevents judge execution.
- **FAIL-002** — Terminal judge failure prevents `COMPLETED` and prevents majority calculation.
- **FAIL-003** — Failure never defaults to a normal verdict.
- **FAIL-004** — `FAILED` is visibly distinct from `COMPLETED`.
- **FAIL-005** — `BLOCKED_BUDGET` is visibly distinct from model failure and verdict.
- **FAIL-006** — Timeout and retry state are observable.

### ECONOMICS

- **ECON-001** — Every successful attempt has required participant/model/usage/cost/latency audit data.
- **ECON-002** — Failed attempts preserve available telemetry and represent unavailable values as unavailable, not fabricated zero.
- **ECON-003** — Run totals equal deterministic aggregation of attempt data.
- **ECON-004** — Pricing snapshot used for historical accounting is retained.
- **ECON-005** — Preflight blocks configurations whose conservative bound exceeds `$5.00`.
- **ECON-006** — Retry is blocked when budget policy does not permit it.
- **ECON-007** — No silent paid-model/provider fallback occurs.
- **ECON-008** — A successful run cannot silently complete with unknown required usage/cost economics.

### HISTORY

- **HIST-001** — Completed runs survive reload and can be reopened.
- **HIST-002** — Reopening a run uses stored results and makes no model call.
- **HIST-003** — Stored majority/protocol/economics correspond to the original run.
- **HIST-004** — Failed runs retain enough audit data for diagnosis.
- **HIST-005** — V1 UI warns that demo submissions may be retained/visible and should not contain sensitive data.
- **HIST-006** — Milestone 5 stored cases survive reload and can be reopened at a basic case-detail level without fabricated verdicts, speeches, protocol, or model economics.

### SECURITY

- **SEC-001** — OpenRouter and privileged database secrets never appear in browser code/bundle.
- **SEC-002** — Authoritative validation occurs server-side.
- **SEC-003** — Budget enforcement and OpenRouter calls occur server-side.
- **SEC-004** — Model output is schema-validated before persistence as valid participant output.
- **SEC-005** — Raw user/model content is rendered safely without executing supplied HTML/script.
- **SEC-006** — Runtime models receive no privileged arbitrary tools in V1.

---

## 26. Architectural Guidance

The architecture must preserve four explicit parts:

- **Browser/frontend:** interaction and presentation.
- **Backend:** authoritative validation, orchestration, OpenRouter, budget/output controls, persistence coordination.
- **Database:** durable cases, runs, configurations, outputs, protocol, economics/audit.
- **Deployment:** publicly reachable web app with a runtime that can safely complete the two-phase deliberation.

OpenRouter remains behind a server-side boundary. Deterministic work stays outside the model. The four advocates and three judges use concurrent phases separated by a hard barrier.

Concrete technology and data relationships are defined in `ARCHITECTURE.md`.

---

## 27. Scope Deferred Beyond V1

Unless intent/spec is deliberately changed:

- real legal advice/authority
- authentication/private multi-user ownership
- RAG/vector database
- model training/fine-tuning
- voice interface
- image generation
- arbitrary participant counts
- autonomous model tools/actions
- genuinely agentic execution mode until course requirement is confirmed
