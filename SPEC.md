# The Tribunal System Specification

## 0. Document Purpose and Precedence

`INTENT.md` answers why The Tribunal exists and preserves durable product direction.

`SPEC.md` defines precise, checkable behaviour for the system. It describes what must be true from the user's and system's observable perspective: inputs, outputs, states, failures, constraints, and acceptance criteria.

Future `ARCHITECTURE.md` will define how the system is structurally implemented. Future `AGENTS.md` will define operational rules for coding agents working in this repository.

If `SPEC.md` and `INTENT.md` ever appear to conflict, an agent must stop and report the conflict rather than silently choose one.

This specification is living. It should evolve deliberately when implementation or verification exposes a requirement problem. A test passing does not override a conflicting written requirement.

## 1. Goal and Reason

The Tribunal exists to make AI deliberation observable. A user submits a debatable case, configures seven distinct AI participants, runs a structured deliberation, and inspects arguments, verdicts, reasoning, protocol, and model-call economics.

The system must not present itself as real legal advice or legal authority. It is an educational and demonstrative product for observing how differently configured AI participants argue and judge the same dispute.

## 2. Canonical Tribunal Terminology

### 2.1 Charge Sheet

The canonical Charge Sheet has exactly three logical parts:

1. Defendant
2. Act
3. Exact Question

The application may serialize these together when sending them to a model, but they remain distinct authoritative fields.

### 2.2 Participant

A participant is one configured AI role in one Tribunal run.

Exactly seven participants exist:

- Advocate PRO 1
- Advocate PRO 2
- Advocate CON 1
- Advocate CON 2
- Judge 1
- Judge 2
- Judge 3

### 2.3 Logical Model Call

A logical model call is the required AI execution for one participant.

A successful normal Tribunal deliberation consists of exactly seven logical participant calls. Retries are attempts of an existing logical call, not additional participants.

### 2.4 Run

A run is one complete attempt to deliberate one configured case.

## 3. Charge Sheet Requirements

The manual Charge Sheet form must collect:

- Defendant
- Act
- Exact Question

All three fields are required.

After trimming whitespace, fields must satisfy these limits:

- Defendant: 1-200 characters
- Act: 1-6000 characters
- Exact Question: 1-1000 characters

An empty or invalid field must prevent the run from starting. Validation failure must identify the offending field.

The application must not use an LLM to determine whether a required field exists.

## 4. Charge Sheet File Input

V1 supports Charge Sheet import from:

- `.txt`
- `.md`

Only UTF-8 text files are supported. The maximum uploaded Charge Sheet file size is `64 KiB`.

The file format uses three labelled sections:

- `DEFENDANT:`
- `ACT:`
- `QUESTION:`

Each marker must appear exactly once. Each section must contain non-empty content after trimming.

Parsing must be deterministic. The application must not call an LLM merely to parse the Charge Sheet file.

Parsed content must still satisfy the canonical field length limits.

Unsupported type, invalid encoding, oversized input, missing section, duplicate section, or empty section must produce a visible validation error.

## 5. Participant Personality Input

Each of the seven participants has independently configurable personality/instruction context.

Personality may be provided by:

- manually entered or pasted text
- `.txt`
- `.md`

Personality files are UTF-8 only. The maximum personality file size is `16 KiB`.

After normalization, personality text must be:

- non-empty
- no more than 4000 characters

Personality is behavioural context. It is not merely a participant display name, and it must not replace the participant's fixed role instructions.

## 6. Advocate Configuration

Every run contains exactly:

- 2 PRO advocates
- 2 CON advocates

The participant count and sides are fixed product rules. A user may configure personality and model selection as permitted by the chosen execution mode, but may not add or remove advocates or change their assigned sides.

Each advocate receives:

- the same canonical Charge Sheet
- its assigned side
- its personality
- the version-controlled base advocate instructions

Each advocate produces exactly one logical speech output.

## 7. Advocate Output Contract

The machine-consumed advocate output must conform conceptually to:

```json
{
  "speech": "..."
}
```

`speech` must:

- exist
- be a string
- be non-empty after trimming

The model must not be trusted merely because it returned valid JSON. The backend must validate the output contract before accepting it as a successful advocate result.

The maximum requested output generation is 1000 output tokens per advocate attempt.

Exact schema-library implementation belongs to architecture and code, not this specification.

## 8. Judge Configuration

Every run contains exactly three judges.

Each judge has independently configurable personality.

Each judge receives:

- the original canonical Charge Sheet
- all four validated advocate speeches
- the judge's personality
- version-controlled base judge instructions

A judge must never run using only a subset of the four intended advocate speeches.

## 9. Verdict Vocabulary

For V1, the canonical judge verdict vocabulary is exactly:

- `GUILTY`
- `NOT_GUILTY`

No third normal verdict value exists in V1. A model response outside this vocabulary is invalid.

Do not silently map arbitrary prose to one of these values unless the future implementation has an explicitly specified deterministic parser that can do so without ambiguity.

The preferred model response is structured output.

## 10. Judge Output Contract

The machine-consumed judge output must conform conceptually to:

```json
{
  "verdict": "GUILTY",
  "reasoning": "..."
}
```

`verdict` must be exactly one of:

- `GUILTY`
- `NOT_GUILTY`

`reasoning` must:

- exist
- be a string
- be non-empty after trimming

The maximum requested output generation is 1200 output tokens per judge attempt.

An invalid verdict or missing/empty reasoning is a failed model attempt, not a valid judgement.

## 11. Execution Configurations

V1 must support two execution configurations.

### 11.1 Shared-Model Mode

One selected OpenRouter model is used for all seven participants.

Participant differences still come from:

- role
- side
- personality
- prompt context

### 11.2 Separate-Model Mode

Each of the seven participants may be assigned an individual OpenRouter model.

The same orchestration and validation rules apply in both modes.

### 11.3 Agent Execution

A true agent-execution configuration remains unresolved course scope. It is not a V1 acceptance criterion at this time.

Do not create fake agent semantics. Future architecture should avoid making a genuine agent execution strategy impossible, but V1 must not pretend normal model calls are agents.

## 12. OpenRouter Requirement

OpenRouter is the required model gateway for V1.

Exact model IDs are not permanent product requirements. They must remain configurable because:

- availability can change
- free models can change
- pricing can change

The application must not silently substitute a different paid model when a selected model fails.

## 13. Deliberation Orchestration

A normal successful run occurs in exactly two dependency phases.

### 13.1 Phase A: Advocates

The four advocate logical calls are independent and should execute concurrently.

No advocate depends on another advocate's output.

### 13.2 Advocate Barrier

Judge execution does not begin until all four advocate speeches have been successfully validated.

### 13.3 Phase B: Judges

Once all four advocate speeches exist, the three judge logical calls are independent and should execute concurrently.

Every judge receives all four validated speeches.

The expected normal successful run contains:

- 4 advocate logical calls
- 3 judge logical calls
- 7 total logical calls

There is no eighth required LLM call.

## 14. Retry Policy

Each logical participant call may be attempted at most two times total:

- 1 initial attempt
- at most 1 retry

The maximum theoretical provider-request attempts in one run is 14.

A retry may occur only for a retryable failure such as:

- transient provider failure
- timeout
- malformed or invalid model output

A retry must not silently change:

- participant
- role
- personality
- side
- selected model

Do not retry:

- invalid user input
- unsupported upload
- invalid configuration
- budget rejection
- missing or unknown required pricing information

Every attempt must be observable in audit data.

## 15. Advocate Failure Behaviour

If an advocate attempt fails, the system may perform its one allowed retry if the failure is retryable and budget policy permits.

If the retry also fails, the logical advocate call is `FAILED`. The run becomes `FAILED`. Judge execution must not begin.

Already completed advocate outputs may be retained for diagnostic and audit inspection, but the application must not present an incomplete run as a valid Tribunal result.

## 16. Judge Failure Behaviour

If a judge attempt fails, the system may perform its one allowed retry if the failure is retryable and budget policy permits.

If the retry also fails, that logical judge call is `FAILED`. The full run becomes `FAILED`.

A majority verdict must not be produced from only one or two valid judges.

Completed speeches and judge outputs may remain inspectable, but the UI must clearly state that the Tribunal did not complete successfully.

Failure must never be represented as `NOT_GUILTY`, `GUILTY`, an empty verdict, or another default-looking result.

## 17. Deterministic Majority

Only after exactly three valid judge verdicts exist may the system calculate a Tribunal majority.

Majority calculation is deterministic ordinary code.

With three binary verdicts, the only valid majority outcomes are:

- `GUILTY`
- `NOT_GUILTY`

Examples:

- `GUILTY` / `GUILTY` / `NOT_GUILTY` -> `GUILTY`
- `GUILTY` / `NOT_GUILTY` / `NOT_GUILTY` -> `NOT_GUILTY`
- three equal verdicts -> that verdict

No LLM call may be used to calculate or reinterpret the majority.

## 18. Full Protocol

V1 resolves the previous protocol-composition assumption as follows: the full Tribunal protocol is assembled deterministically from already stored data.

It must include or reference:

- canonical Charge Sheet
- participant configuration relevant to the run
- four advocate speeches
- three judge verdicts
- three judge reasonings
- deterministic majority verdict
- model-call economics

Protocol generation must not require an eighth LLM call.

The protocol is an assembled record, not a new AI opinion.

## 19. Economics and Model-Call Audit

Every model-call attempt must record, where available or reliably derivable:

- participant identity
- participant role
- participant side if applicable
- selected provider/model ID
- attempt number
- status
- input tokens
- output tokens
- total tokens
- applicable input-token price
- applicable output-token price
- calculated or observed cost in USD
- latency
- failure/error category where applicable

The run must deterministically aggregate:

- logical calls
- provider attempts
- input tokens
- output tokens
- total tokens
- advocate cost
- judge cost
- total cost
- relevant timing/latency summary

Pricing used for a call must be auditable.

Exact persistence schema and provider-metadata implementation belong to later architecture.

## 20. Hard Cost Policy

Maximum model spend policy for one complete run: `$5 USD`.

This ceiling includes retries.

The design target is substantially below `$5 USD` and should prefer free or very-low-cost OpenRouter models.

Before starting a run, the backend must perform a conservative budget preflight using:

- selected model pricing known at that time
- configured output-token ceilings
- normalized input size or estimated input-token exposure
- all seven required logical calls

If required pricing information cannot be established reliably, the run must not begin with that configuration.

Before any retry or additional provider attempt, the backend must verify that performing the attempt remains within the run budget policy.

No silent paid fallback is permitted.

Budget rejection is a visible system state, not a model failure and not a verdict.

The exact pricing-fetch, cache, and reservation algorithm belongs to `ARCHITECTURE.md` and the future economics specification.

## 21. Request Timeout Policy

Each individual model-provider attempt has a V1 timeout target of 60 seconds.

A timed-out attempt is a failed attempt and may consume its one retry if retry policy and budget policy permit.

The eventual architecture must choose a runtime/deployment design capable of supporting the required two-phase deliberation without falsely reporting success after infrastructure timeouts.

## 22. Run States

At minimum, the product must distinguish these conceptual states:

- `DRAFT`
- `READY`
- `ADVOCATES_RUNNING`
- `JUDGES_RUNNING`
- `COMPLETED`
- `FAILED`
- `BLOCKED_BUDGET`

The exact internal enum names may differ, but these user-observable meanings must remain distinguishable.

`FAILED` must not look like `COMPLETED`.

`BLOCKED_BUDGET` must not look like a model verdict.

## 23. Result Information Hierarchy

For a `COMPLETED` run, the result experience must prioritize information in this order:

1. Tribunal majority verdict
2. The three individual judge verdicts shown together
3. Judge reasoning
4. Full advocate speeches
5. Deliberation economics and detailed call audit

A concise economics summary may be shown earlier as supporting metadata, but it must not displace the verdict hierarchy.

The user must not have to infer disagreement by searching through three separate unrelated screens.

## 24. Deliberation Feedback

While a run is in progress, the UI must expose meaningful progress.

During the advocate phase, show the status of all four advocates.

After the advocate barrier succeeds, show the status of all three judges.

The UI must distinguish:

- waiting
- running
- succeeded
- retrying where relevant
- failed

Do not show a blank result area as the only loading state.

## 25. Persistence and Past Cases

Completed Tribunal runs must be persisted.

Failed runs should retain enough audit information to diagnose the failure.

The application must provide a Past Cases/history experience from which a completed case can be reopened.

Reopening a completed run must display stored historical results; it must not automatically call the LLM again.

V1 is a single-tenant educational/course-demo application. V1 does not require user accounts or login.

Stored demo cases belong to the application instance rather than to separate user accounts.

Because there is no authentication boundary in V1, the eventual UI must clearly disclose that submitted cases may be retained and visible in the demo history.

Users should be warned not to submit sensitive/private information.

Multi-user private ownership is outside V1 unless scope is deliberately changed later.

## 26. Secrets and Authority Boundary

The browser must never receive:

- OpenRouter API keys
- privileged database credentials
- other server secrets

The authoritative validation, budget enforcement, model calls, model output validation, and persistence operations must occur in trusted backend/server-side code.

Client-side validation may improve UX but cannot be the only validation.

Detailed security controls belong to the later security document.

## 27. Prompt Requirements

Runtime base prompts must be version controlled.

The system should maintain distinct base behavioural instructions for:

- advocates
- judges

Participant personality is injected/configured context and must not replace those base role instructions.

User-provided Charge Sheet and personality content must be treated as untrusted input.

Prompt wording is runtime behaviour, and changes to important prompts must be reviewable through Git.

Detailed prompt text belongs later.

## 28. Acceptance Criteria

These criteria are target requirements. They do not claim that the current repository already implements the behaviour.

### 28.1 Case

- CASE-001: The system requires Defendant, Act, and Exact Question for every Charge Sheet.
- CASE-002: A valid manually entered Charge Sheet is accepted.
- CASE-003: An empty Defendant field is rejected visibly and identifies Defendant as invalid.
- CASE-004: An empty Act field is rejected visibly and identifies Act as invalid.
- CASE-005: An empty Exact Question field is rejected visibly and identifies Exact Question as invalid.
- CASE-006: A Defendant longer than 200 characters after trimming is rejected visibly.
- CASE-007: An Act longer than 6000 characters after trimming is rejected visibly.
- CASE-008: An Exact Question longer than 1000 characters after trimming is rejected visibly.
- CASE-009: A valid structured `.txt` Charge Sheet import is accepted.
- CASE-010: A valid structured `.md` Charge Sheet import is accepted.
- CASE-011: An unsupported Charge Sheet file type is rejected visibly.
- CASE-012: A non-UTF-8 Charge Sheet file is rejected visibly.
- CASE-013: A Charge Sheet file larger than 64 KiB is rejected visibly.
- CASE-014: A Charge Sheet file missing any required labelled section is rejected visibly.
- CASE-015: A Charge Sheet file with a duplicate labelled section is rejected visibly.
- CASE-016: A Charge Sheet file with an empty labelled section is rejected visibly.
- CASE-017: File parsing is deterministic and does not call an LLM.

### 28.2 Participants

- PART-001: Every run contains exactly 2 PRO advocates.
- PART-002: Every run contains exactly 2 CON advocates.
- PART-003: Every run contains exactly 3 judges.
- PART-004: Users cannot add or remove participants in V1.
- PART-005: Users cannot change advocate side assignment in V1.
- PART-006: Each participant has independent personality configuration.
- PART-007: Valid manually entered personality text is accepted.
- PART-008: Valid `.txt` personality import is accepted.
- PART-009: Valid `.md` personality import is accepted.
- PART-010: Empty personality text is rejected visibly.
- PART-011: Personality text longer than 4000 characters after normalization is rejected visibly.
- PART-012: A personality file larger than 16 KiB is rejected visibly.
- PART-013: Personality context does not replace the fixed base role instructions.

### 28.3 Run and Execution

- RUN-001: Shared-Model Mode applies one selected OpenRouter model to all seven participants.
- RUN-002: Separate-Model Mode honours participant-specific OpenRouter model assignments.
- RUN-003: The four advocate logical calls can execute without depending on each other.
- RUN-004: Judge execution does not begin until all four advocate speeches validate.
- RUN-005: Each judge receives all four validated advocate speeches.
- RUN-006: A successful no-retry run contains exactly seven logical model calls.
- RUN-007: Retries are recorded as attempts of existing logical calls, not new participants.
- RUN-008: No logical call receives more than one retry.
- RUN-009: A retry does not silently change participant, role, side, personality, or selected model.
- RUN-010: Agent Execution is not required for V1 and normal model calls are not described as agents.

### 28.4 Output

- OUT-001: A valid advocate result contains a non-empty string `speech`.
- OUT-002: An advocate result missing `speech` is rejected as invalid.
- OUT-003: An advocate result with empty `speech` is rejected as invalid.
- OUT-004: A valid judge result contains a verdict and non-empty reasoning.
- OUT-005: Only `GUILTY` and `NOT_GUILTY` are accepted as normal V1 verdicts.
- OUT-006: A judge result with any other verdict value is rejected as invalid.
- OUT-007: A judge result with missing or empty reasoning is rejected as invalid.
- OUT-008: Deterministic majority is correct for all three-verdict binary combinations.
- OUT-009: Majority calculation never calls an LLM.
- OUT-010: The full protocol is assembled without an eighth model call.
- OUT-011: The protocol includes or references the canonical Charge Sheet, participant configuration, speeches, judge verdicts, judge reasonings, deterministic majority verdict, and model-call economics.

### 28.5 Failure

- FAIL-001: Advocate terminal failure prevents the judge phase from starting.
- FAIL-002: Judge terminal failure prevents a `COMPLETED` result.
- FAIL-003: A majority verdict is not produced from fewer than three valid judge verdicts.
- FAIL-004: Invalid model output does not reach the UI as a valid verdict.
- FAIL-005: Timeout is visible as a failure or retry state.
- FAIL-006: No error path defaults to `GUILTY`.
- FAIL-007: No error path defaults to `NOT_GUILTY`.
- FAIL-008: `FAILED` is visibly distinct from `COMPLETED`.
- FAIL-009: `BLOCKED_BUDGET` is visibly distinct from a model verdict.
- FAIL-010: Unsupported or invalid uploaded input is not retried as a model call.
- FAIL-011: Budget rejection is not represented as model failure.

### 28.6 Economics

- ECON-001: Every model-call attempt records participant identity, role, model, attempt number, and status.
- ECON-002: Every model-call attempt records input tokens, output tokens, and total tokens where available or reliably derivable.
- ECON-003: Every model-call attempt records applicable input-token and output-token prices where available or reliably derivable.
- ECON-004: Every model-call attempt records calculated or observed cost in USD where available or reliably derivable.
- ECON-005: Every model-call attempt records latency.
- ECON-006: Failed attempts record a failure/error category.
- ECON-007: Run totals equal deterministic aggregation of individual attempt data.
- ECON-008: A configuration that violates preflight budget policy is blocked visibly.
- ECON-009: Retry is blocked if budget policy would be violated.
- ECON-010: No silent paid fallback occurs.
- ECON-011: The `$5 USD` ceiling applies to one complete Tribunal run and includes retries.

### 28.7 History

- HIST-001: A completed run survives reload or reopen.
- HIST-002: Reopening a completed run displays stored historical results.
- HIST-003: Reopening a completed run does not call models again.
- HIST-004: Stored majority, protocol, and economics match the original run.
- HIST-005: Failed runs retain enough audit information to diagnose the failure.
- HIST-006: The UI discloses that submitted cases may be retained and visible in demo history.
- HIST-007: The UI warns users not to submit sensitive or private information.

### 28.8 Security Boundary

- SEC-001: No OpenRouter secret exists in client-side source or browser bundle.
- SEC-002: No privileged database credential exists in client-side source or browser bundle.
- SEC-003: Backend/server-side code independently validates authoritative inputs.
- SEC-004: Backend/server-side code enforces budget policy.
- SEC-005: Backend/server-side code performs OpenRouter calls.
- SEC-006: Model output is parsed and validated before becoming application data.
- SEC-007: Client-side validation is not treated as authoritative enforcement.

## 29. Validation Approach

### 29.1 Unit Validation

Future unit tests should cover at least:

- Charge Sheet validators
- Charge Sheet file parser
- personality validation
- verdict validation
- majority calculation
- cost aggregation
- budget logic
- run-state transitions

### 29.2 Integration Validation

Using a mocked or fake OpenRouter boundary, future integration tests should verify:

- four advocate calls are initiated for a valid run
- judge phase starts only after all four valid speeches
- exactly three judge calls are then initiated
- all judges receive all four speeches
- Shared-Model and Separate-Model routing are correct
- retry limits hold
- phase failure rules hold
- economics aggregate correctly

### 29.3 End-to-End Validation

Eventually verify this user flow:

1. Create Case
2. Configure participants
3. Review
4. Deliberate
5. View result
6. Reopen from Past Cases

### 29.4 Failure-Focused Scenarios

Manual or automated validation should explicitly include:

- timeout
- provider unavailable
- malformed advocate JSON
- empty speech
- malformed judge JSON
- invalid verdict
- empty reasoning
- one advocate permanently failing
- one judge permanently failing
- unsupported file
- oversized file
- missing Charge Sheet section
- budget preflight rejection
- retry blocked by budget

## 30. Known Pitfalls

Known traps to avoid:

- a judge may return prose instead of the required structure
- a model call may time out
- a Charge Sheet may omit the exact question
- a malformed result may look fluent and convincing
- a silent failure can accidentally look like `NOT_GUILTY`
- a judge must never receive only some advocate arguments
- retries can multiply cost
- judges consume more input because they read all advocate speeches
- free-model availability can change
- model pricing can change
- a pricing lookup can become stale
- a protocol generated with another model call would change the seven-call economics
- sequential execution would create unnecessary latency
- client-side-only validation is not authoritative
- prompt/personality input may contain adversarial instructions

This section identifies requirement-level risks, not architecture-specific implementation solutions.

## 31. Architectural Guidance: Boundaries Only

This section defines required boundaries without choosing concrete technology.

- Browser: input, interaction, and result presentation; no secrets or authoritative enforcement.
- Backend: authoritative validation, orchestration, OpenRouter calls, budget enforcement, output validation, and persistence coordination.
- Persistent store: cases, run configuration, participant outputs, verdicts, and model-call audit.
- Deployment: must support the real two-phase runtime and expose a reachable web application.

OpenRouter remains behind a server-side service boundary.

Four advocates are parallelizable.

Three judges are parallelizable after the advocate barrier.

Deterministic logic stays outside the model.

Do not choose the concrete frontend framework, backend hosting, database, ORM, or deployment provider in `SPEC.md`. Those belong to `ARCHITECTURE.md`.

## 32. Deferred Architecture Decisions

The following decisions are explicitly deferred to the next Milestone 2 step:

- frontend framework
- backend/runtime technology
- database/provider
- deployment provider
- exact persistence schema
- API route design
- server-function organization
- model-client implementation
- pricing cache design
- concurrency implementation
- schema-validation library
- test framework
- CI implementation

True Agent Execution remains unresolved pending course clarification.

## 33. Cross-Document Consistency Notes

This specification preserves the approved conception in the existing Milestone 1 documents:

- participant count remains exactly seven
- Shared-Model and Separate-Model configurations remain required
- Agent Execution remains unresolved
- OpenRouter remains required
- the hard run-cost ceiling remains `$5 USD` per complete run
- deterministic majority remains non-AI
- failure never becomes a verdict
- exact architecture stack is not chosen
- no application functionality is claimed to already exist
- the existing Definition of Done remains target criteria rather than completed work

Previously open decisions now resolved by this specification include V1 Charge Sheet fields, V1 `.txt`/`.md` upload support, V1 verdict vocabulary, V1 protocol assembly, retry limit, timeout target, and conceptual run states.
