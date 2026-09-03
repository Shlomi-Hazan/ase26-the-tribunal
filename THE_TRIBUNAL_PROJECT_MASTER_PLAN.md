# The Tribunal — Project Master Plan

> **Course:** Agentic Software Engineering (ASE-26)
> **Project:** The Tribunal
> **Purpose:** Build a complete, verifiable, well-documented cognified web application while demonstrating disciplined agentic software engineering from project conception through deployment.

> **Document status:** This is a comprehensive planning and historical reference artifact. When it differs from later focused decisions, `INTENT.md`, `SPEC.md`, `ARCHITECTURE.md`, and the relevant focused engineering document take precedence.

---

## 1. Project North Star

The Tribunal is a web application that receives a **Charge Sheet** describing a case and uses multiple AI participants to argue, deliberate, and produce verdicts.

The system contains:

- **2 PRO Advocates**
- **2 CON Advocates**
- **3 Judges**

Each of the seven AI participants has an independent **personality**, provided through a system prompt. The personality must affect how that participant argues or judges.

A complete Tribunal run produces:

- Four advocate speeches
- Three individual judge verdicts
- Three judge reasoning protocols
- A deterministic majority result
- A complete deliberation protocol
- Model and token usage information
- Per-call and total cost information
- Latency information
- A persisted audit trail that can be reopened later

The project must demonstrate not only a working application, but also a disciplined engineering process that can be inspected and verified from the repository.

---

## 2. Core Tribunal Flow

```text
                         CHARGE SHEET
                              │
               ┌──────────────┼──────────────┐
               │              │              │
               ▼              ▼              ▼
            PRO #1         PRO #2       CON #1       CON #2
               │              │            │            │
         Personality A  Personality B Personality C Personality D
               │              │            │            │
               └──────────────┴──────┬─────┴────────────┘
                                     ▼
                                4 SPEECHES
                                     │
                         ┌───────────┼───────────┐
                         ▼           ▼           ▼
                      JUDGE #1    JUDGE #2    JUDGE #3
                         │           │           │
                   Personality   Personality   Personality
                         │           │           │
                         └───────────┼───────────┘
                                     ▼
                                3 VERDICTS
                                     │
                                     ▼
                           DETERMINISTIC MAJORITY
                                     │
                                     ▼
                             FINAL PROTOCOL
                                     +
                         TOKEN / COST ECONOMICS
```

---

## 3. Advocate Requirements

There are exactly four advocates:

- PRO Advocate #1
- PRO Advocate #2
- CON Advocate #1
- CON Advocate #2

Each advocate receives:

1. The Charge Sheet
2. Their assigned side: PRO or CON
3. Their personal system-prompt personality
4. The base advocate instructions

Each advocate returns a **speech** intended to persuade the judges toward the assigned side.

### Advocate input contract

```text
Charge Sheet
+ Side: PRO / CON
+ Personality
+ Advocate instructions
```

### Advocate output contract

Prefer a structured result such as:

```json
{
  "speech": "..."
}
```

The backend must validate the response structure before accepting it.

---

## 4. Judge Requirements

There are exactly three judges.

Each judge receives:

1. The original Charge Sheet
2. All four advocate speeches
3. Their personal system-prompt personality
4. Judge instructions requiring a verdict and explanation

Each judge returns:

- A verdict
- A reasoning protocol explaining the decision

### Judge input contract

```text
Charge Sheet
+ PRO Speech #1
+ PRO Speech #2
+ CON Speech #1
+ CON Speech #2
+ Judge Personality
+ Judge Instructions
```

### Judge output contract

Prefer a structured result such as:

```json
{
  "verdict": "GUILTY",
  "reasoning": "..."
}
```

The backend must validate the verdict and reasoning before accepting the response.

---

## 5. Final System Output

A completed Tribunal run should display the following information in a clear hierarchy.

### 5.1 Verdict Summary

- Judge #1 verdict
- Judge #2 verdict
- Judge #3 verdict
- Deterministic majority result

The majority calculation should be performed with ordinary application code, not another LLM call.

### 5.2 Judge Protocol

For every judge:

- Judge identity/label
- Personality used
- Model used
- Verdict
- Full reasoning

### 5.3 Advocate Speeches

For every advocate:

- Advocate identity/label
- Side: PRO / CON
- Personality used
- Model used
- Speech

### 5.4 Cognified Software Economics

For every model call:

- Participant
- Role
- Model
- Input tokens
- Output tokens
- Total tokens
- Input-token price
- Output-token price
- Cost of the call
- Latency
- Status

For the complete run:

- Number of model calls
- Total input tokens
- Total output tokens
- Total tokens
- Total advocate cost
- Total judge cost
- Total run cost
- Total/observed latency

---

## 6. Execution Modes

The architecture must support multiple execution configurations without duplicating the entire Tribunal workflow.

### 6.1 Mode A — Shared Model

One selected LLM is used by all seven participants.

```text
PRO #1   ─┐
PRO #2   ─┤
CON #1   ─┤
CON #2   ─┤──> SAME MODEL
Judge #1 ─┤
Judge #2 ─┤
Judge #3 ─┘
```

The seven participants still have different personalities.

This mode allows comparison of how strongly different system prompts and personalities influence the same underlying model.

### 6.2 Mode B — Multi-Model

Each participant may use a different model.

```text
PRO #1   -> Model A
PRO #2   -> Model B
CON #1   -> Model C
CON #2   -> Model D
Judge #1 -> Model E
Judge #2 -> Model F
Judge #3 -> Model G
```

The workflow remains the same; only model assignment changes.

### 6.3 Mode C — Agent Execution (Historical; Cancelled)

Earlier planning for this project considered a true agent-based execution mode, conditional on the course requirement being confirmed. That original text is preserved below for historical record:

> The project architecture should leave room for a true agent-based execution mode if the course requirement is confirmed. This must not be implemented as ordinary LLM calls merely renamed as “agents.” A genuine agent execution strategy should explicitly define the role, context, goal, loop, tools if needed, and output contract. This mode should be added only when the exact course requirement is confirmed.

**This mode is now cancelled and removed from the active product plan.** It is not deferred and not conditional — the confirmation this section anticipated did not happen; instead, Milestone 12 was redefined. `ROADMAP.md` (Milestone 12), `SPEC.md` §7.3, and [Issue #32](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/32) are the current authoritative sources on this decision; where this document differs from them, per its own stated precedence rule (see the "Document status" note at the top of this file), they govern. Milestone 12 is now the **Canonical Jon Snow Demo**, not Agent Execution.

---

## 7. Input Methods

The project must support both direct text entry and file-based input where appropriate.

### 7.1 Charge Sheet

The user can either:

- Write/paste the Charge Sheet manually
- Upload a Charge Sheet file

The first implementation should prefer simple text-based file formats such as:

- `.txt`
- `.md`

More complex document parsing, such as PDF, should be added only if required.

### 7.2 Participant Personality

Each of the seven participants must support:

```text
[ Write Personality ]

OR

[ Upload Personality File ]
```

The stored result used during the run should always become plain validated text before being sent to the model.

---

## 8. Cognified Software Boundary

The project should deliberately separate deterministic application logic from AI reasoning.

### Plain code should handle

- Validation
- Authentication, if later required
- Database operations
- File handling
- Majority calculation
- Token accounting
- Cost calculation
- Budget enforcement
- Model-call orchestration
- Status tracking
- Error handling
- UI rendering
- History retrieval

### Models should handle

- Argument construction
- Persuasive reasoning
- Evaluation of arguments
- Judicial reasoning
- Verdict generation

The application must avoid unnecessary LLM calls when deterministic code is sufficient.

---

## 9. OpenRouter and Model Strategy

All model access should go through **OpenRouter**.

### Model-selection priorities

1. Prefer free models when practical
2. Prefer very inexpensive models when free models are not appropriate
3. Do not optimize primarily for model performance
4. Maintain model configurability
5. Record the exact model used for every call

### Security rule

The OpenRouter API key must remain server-side and must never be exposed in browser code or committed to Git.

---

## 10. Hard Cost Constraint

A complete Tribunal run must never intentionally exceed:

```text
MAXIMUM RUN BUDGET = $5.00 USD
```

The preferred target is far below $5 whenever possible.

### Budget controls

- Store a configurable maximum run budget
- Set maximum output-token limits per participant
- Obtain or store model pricing
- Perform a preflight budget estimate where practical
- Block a run if the configured worst-case estimate exceeds the hard limit
- Do not silently fall back to an expensive model
- Record actual usage and actual/derived cost after every call

---

## 11. Economic Blast Radius

The system must explicitly limit how much money a single deliberation can spend.

Conceptually:

```text
Selected Models
      │
      ▼
Pricing + Token Limits
      │
      ▼
Estimated Maximum Cost
      │
      ├── > $5.00 -> BLOCK RUN
      │
      └── <= $5.00 -> ALLOW RUN
```

The budget policy is part of the architecture, not merely an accounting report.

---

## 12. Pricing Snapshot Strategy

Model prices can change over time. Historical runs must still remain understandable.

For each run/call, store the relevant pricing snapshot used for the calculation, for example:

```text
model_id
input_price_at_run
output_price_at_run
```

This makes historical cost records reproducible and auditable.

---

## 13. Parallel Execution

The four advocates do not depend on one another and should run in parallel.

```text
             ┌-> PRO #1
             ├-> PRO #2
Charge Sheet ├-> CON #1
             └-> CON #2
                    │
                    ▼
              4 SPEECHES
```

The judges depend on all four speeches, so the judge phase begins only after the advocate phase finishes successfully.

The three judges should then run in parallel.

```text
4 Speeches
    │
    ├-> Judge #1
    ├-> Judge #2
    └-> Judge #3
```

The intended baseline is **7 model calls per completed run**.

---

## 14. Error Handling

Failures must be represented as failures, never as default verdicts.

### 14.1 Advocate Failure

Recommended baseline:

```text
Advocate call fails
      │
      ▼
Retry once
      │
      ▼
Still fails?
      │
      └-> Mark Tribunal run FAILED
```

The judges should not deliberate on an incomplete set of advocate speeches unless the specification is explicitly changed later.

### 14.2 Judge Failure

Recommended baseline:

```text
Judge call fails
      │
      ▼
Retry once
      │
      ▼
Still fails?
      │
      └-> Show explicit judge/run failure
```

A failed judge must never silently become GUILTY, NOT GUILTY, or any other valid verdict.

### 14.3 Other failure cases

The system should eventually test and handle:

- OpenRouter timeout
- Provider/network failure
- Invalid JSON
- Missing speech
- Missing verdict
- Unsupported verdict value
- Missing reasoning
- File too large
- Unsupported file type
- Empty input
- Invalid model
- Provider unavailable
- Budget threshold exceeded
- Malicious or prompt-injection-like user content

---

## 15. UI Design Direction

The interface should be **minimal in interaction complexity, but polished in visual design**.

### Design direction

**Modern Digital Courtroom**

Desired qualities:

- Elegant
- Spacious
- Clear hierarchy
- Strong typography
- High contrast
- Restrained visual language
- Clean cards
- Subtle borders
- Subtle motion
- Responsive layout
- Good loading, empty, success, and error states

Avoid unnecessary controls, visual clutter, or gimmicky courtroom decoration.

---

## 16. Main Product Screens

### 16.1 Home / New Case

Primary action:

```text
THE TRIBUNAL

Bring a Case
```

### 16.2 Case Setup

Suggested step flow:

```text
1. Charge Sheet
2. Advocates
3. Judges
4. Review
```

### 16.3 Advocates Screen

Four participant cards:

```text
PRO I
PRO II
CON I
CON II
```

Each card contains:

- Participant label/name
- Side
- Personality input
- Write / Upload control
- Model selection where applicable

### 16.4 Judges Screen

Three cards:

```text
Judge I
Judge II
Judge III
```

Each card contains:

- Participant label/name
- Personality input
- Write / Upload control
- Model selection where applicable

### 16.5 Review Screen

Before spending money, show:

- Execution mode
- Seven configured participants
- Selected model(s)
- Expected model-call count
- Estimated cost where possible
- Hard budget limit

Primary action:

```text
[ Convene Tribunal ]
```

### 16.6 Deliberation Screen

Do not use only a generic spinner.

Example state:

```text
THE TRIBUNAL IS IN SESSION

Preparing Arguments

PRO I    ✓
PRO II   ✓
CON I    ●
CON II   ✓

Waiting for Judges
```

Then:

```text
Judge I     Deliberating...
Judge II    Deliberating...
Judge III   Deliberating...
```

### 16.7 Result Screen

Preferred information hierarchy:

```text
VERDICT / MAJORITY RESULT
        ↓
3 JUDGE VOTES
        ↓
JUDGE REASONING
        ↓
ADVOCATE SPEECHES
        ↓
DELIBERATION ECONOMICS
```

### 16.8 Past Cases

The user should be able to browse previously completed runs and reopen:

- Charge Sheet
- Participant configuration
- Speeches
- Verdicts
- Reasoning
- Economics
- Run metadata

---

## 17. Cognified Economics UI

### Summary example

```text
7 CALLS
17,233 TOKENS
$0.14 COST
6.82 sec
```

### Detailed breakdown

| Participant | Model | Input Tokens | Output Tokens | Total Tokens | Cost | Time |
|---|---|---:|---:|---:|---:|---:|
| PRO I | Model A | ... | ... | ... | ... | ... |
| PRO II | Model A | ... | ... | ... | ... | ... |
| CON I | Model A | ... | ... | ... | ... | ... |
| CON II | Model A | ... | ... | ... | ... | ... |
| Judge I | Model A | ... | ... | ... | ... | ... |
| Judge II | Model A | ... | ... | ... | ... | ... |
| Judge III | Model A | ... | ... | ... | ... | ... |

### Derived cost formula

```text
input_cost = input_tokens / 1,000,000 * input_rate
output_cost = output_tokens / 1,000,000 * output_rate
call_cost = input_cost + output_cost
```

If OpenRouter returns authoritative actual cost data, preserve that data as well.

---

## 18. Proposed Technology Stack

The stack should stay reasonably close to the course toolbox while remaining simple enough for a student project.

### Frontend

- React
- TypeScript

### Backend

A server-side API/function layer suitable for long-running model calls.

The exact hosting choice should be confirmed after checking execution-time limits.

### Database

- Supabase
- PostgreSQL

### Optional File Storage

- Supabase Storage, only if original uploaded files need to be retained

### LLM Gateway

- OpenRouter

### Version Control

- Git
- GitHub

### Deployment

Prefer infrastructure compatible with the course recommendations, such as Netlify and/or Supabase server-side functionality, but confirm model-call timeout requirements before finalizing the backend deployment design.

---

## 19. Proposed Repository Structure

```text
ase26-the-tribunal/
│
├── README.md
├── INTENT.md
├── SPEC.md
├── ARCHITECTURE.md
├── ROADMAP.md
├── AGENTS.md
├── CLAUDE.md
├── SECURITY.md
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
│
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── ISSUE_TEMPLATE/
│   └── workflows/
│       └── ci.yml
│
├── docs/
│   ├── conception/
│   │   ├── problem-statement.md
│   │   ├── stakeholders.md
│   │   ├── definition-of-done.md
│   │   ├── out-of-scope.md
│   │   └── assumptions.md
│   │
│   ├── ui-spec.md
│   ├── economics.md
│   │
│   ├── adr/
│   │   ├── 001-tech-stack.md
│   │   ├── 002-llm-boundary.md
│   │   ├── 003-execution-modes.md
│   │   └── ...
│   │
│   ├── verification/
│   │   ├── milestone-01.md
│   │   ├── milestone-02.md
│   │   └── ...
│   │
│   └── evaluation/
│       └── tribunal-cases.md
│
├── src/
│   ├── frontend/
│   ├── backend/
│   ├── tribunal/
│   ├── openrouter/
│   ├── prompts/
│   ├── economics/
│   ├── database/
│   └── validation/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
└── supabase/
    └── migrations/
```

Folders should be created only when they become useful; the repository should not contain empty structure purely for appearance.

---

# 20. Documentation Files

## 20.1 `INTENT.md`

Defines why the project exists.

It should answer:

- What is the project fundamentally for?
- Who is it for?
- What is its primary usefulness?
- Why does cognified software make sense here?
- Why are multiple viewpoints useful?
- What constraints shape the solution?

It should describe intent, not implementation details.

---

## 20.2 `docs/conception/problem-statement.md`

Describe the situation/problem the project addresses without prematurely defining the technical solution.

---

## 20.3 `docs/conception/stakeholders.md`

Potential stakeholders include:

- Primary user
- Student/developer
- Course instructor/evaluator
- OpenRouter/model providers
- Hosting/database providers

---

## 20.4 `docs/conception/definition-of-done.md`

Contains observable yes/no completion criteria.

Examples:

- A user can submit a Charge Sheet.
- There are exactly two PRO advocates.
- There are exactly two CON advocates.
- Every advocate has an independent personality.
- Every judge has an independent personality.
- All four speeches reach all three judges.
- Three verdicts are produced.
- Token usage is recorded.
- Cost is recorded per call.
- Total cost is displayed.
- A run cannot violate the configured $5 limit.
- Past cases can be reopened.

---

## 20.5 `docs/conception/out-of-scope.md`

Explicitly records features intentionally excluded.

Possible initial exclusions:

- Social network features
- User-to-user chat
- Payments
- Voice interface
- Fine-tuning
- RAG
- Model training
- Real legal advice
- Unnecessary authentication for the MVP, if not required

---

## 20.6 `docs/conception/assumptions.md`

Tracks unresolved assumptions and decisions still needing confirmation.

Examples:

- Whether Agent Mode is a mandatory distinct implementation
- Whether PDF upload is required
- Whether authentication is required
- Whether original uploaded files must be retained
- Exact verdict vocabulary
- Exact required protocol format

---

## 20.7 `SPEC.md`

The primary product specification.

Suggested sections:

1. Goal and reason
2. Functional requirements
3. Testable acceptance criteria
4. Architectural guidance
5. Validation approach
6. Known pitfalls
7. Error behavior
8. Budget behavior
9. Data retention behavior
10. Execution-mode behavior

The specification should be changed before code whenever the intended behavior changes.

---

## 20.8 `ARCHITECTURE.md`

Documents:

- Browser/frontend
- Backend authority boundary
- Database
- Deployment
- OpenRouter integration
- Request lifecycle
- Advocate phase
- Judge phase
- Parallelism
- LLM/application boundary
- Execution strategies
- Failure handling
- Database relationships
- Security boundaries

---

## 20.9 `AGENTS.md`

Defines standing instructions for Codex and other coding agents.

It should remain focused and reasonably short.

Suggested content:

```text
Project purpose

Read before changing code:
- INTENT.md
- SPEC.md
- ARCHITECTURE.md

Rules:
- Do not modify main directly.
- Do not silently change product scope.
- Do not expose API keys.
- Do not invent requirements.
- Do not add dependencies without justification.
- Do not change prompts without review.
- Keep deterministic work out of LLM calls.
- Respect the $5 run budget.
- Prefer minimal diffs.
- Run verification before reporting completion.

Stop and ask when:
- A requirement conflicts with SPEC.md.
- Architecture must change.
- A new paid dependency is required.
- A security boundary changes.
- Provider/model behavior is uncertain.
```

---

## 20.10 `CLAUDE.md`

Keep this concise and avoid duplicating `AGENTS.md`.

Example responsibility:

```text
Read and follow AGENTS.md.

Build command: ...
Test command: ...
Lint command: ...
Typecheck command: ...
```

Add Claude Code-specific operational guidance only when necessary.

---

## 20.11 `README.md`

Acts as the front door to the repository.

Suggested sections:

- What is The Tribunal?
- Demo/deployment link
- Architecture at a glance
- Core features
- Execution modes
- Local setup
- Environment variables
- Run commands
- Testing
- Deployment
- Documentation map
- Known limitations

The README should not replace the formal specification.

---

## 20.12 `ROADMAP.md`

Tracks planned milestones and completion status.

---

## 20.13 `SECURITY.md`

Should document at minimum:

- OpenRouter key remains server-side
- `.env` is never committed
- `.env.example` contains names/placeholders only
- File-type and file-size restrictions
- Model output is untrusted input
- User-provided text is untrusted input
- Prompt injection considerations
- Spending limits
- No silent expensive-model fallback
- Secrets discovered in Git history must be rotated

---

## 20.14 `docs/ui-spec.md`

Define:

1. User flow
2. Information hierarchy
3. Interaction model
4. Feedback and bad states

Avoid pixel-by-pixel design specifications unless later required.

---

## 20.15 `docs/economics.md`

Document:

- Input-token pricing
- Output-token pricing
- Pricing snapshots
- Usage accounting
- Per-call cost
- Total run cost
- Cost-source precedence
- Maximum run budget
- Preflight estimation
- Budget-failure behavior

---

## 20.16 Architecture Decision Records (`docs/adr/`)

Use ADRs for decisions worth preserving long-term.

Examples:

- `001-tech-stack.md`
- `002-llm-boundary.md`
- `003-execution-modes.md`
- `004-openrouter-as-model-gateway.md`
- `005-budget-enforcement.md`

Each ADR should state:

- Context
- Decision
- Alternatives considered
- Consequences

---

# 21. Proposed Database Model

## 21.1 `cases`

Possible fields:

```text
id
charge_sheet_text
exact_question
source_type
source_filename
created_at
```

The exact Charge Sheet structure can be refined in the specification.

## 21.2 `tribunal_runs`

```text
id
case_id
execution_mode
status
majority_verdict
total_input_tokens
total_output_tokens
total_cost
total_latency
created_at
```

## 21.3 `participant_configs`

Seven participant configurations per run.

```text
id
run_id
role
side
personality_text
personality_source
model_id
```

Roles:

```text
ADVOCATE
JUDGE
```

Sides:

```text
PRO
CON
NULL for judges
```

## 21.4 `model_calls`

The core cognified audit record.

```text
id
run_id
participant_id
provider
model
status
input_tokens
output_tokens
total_tokens
input_price
output_price
cost
started_at
completed_at
latency_ms
provider_request_id
error
```

## 21.5 `speeches`

```text
participant_id
content
```

## 21.6 `verdicts`

```text
judge_id
verdict
reasoning
```

The schema should be finalized through migrations rather than ad-hoc production changes.

---

# 22. Prompt Architecture

Prompts must be version-controlled because they are part of runtime behavior.

Suggested structure:

```text
src/prompts/
├── advocate-system.ts
├── judge-system.ts
└── schemas.ts
```

Use reusable base prompts plus configuration rather than seven unrelated hard-coded prompts.

Conceptually:

```text
BASE ADVOCATE SYSTEM PROMPT
+ SIDE
+ PERSONALITY
+ CHARGE SHEET
```

and:

```text
BASE JUDGE SYSTEM PROMPT
+ PERSONALITY
+ CHARGE SHEET
+ ALL FOUR SPEECHES
```

Prompt modifications should be reviewed and committed like code changes.

---

# 23. Git and GitHub Strategy

The GitHub repository should exist before meaningful implementation begins.

Recommended repository name:

```text
ase26-the-tribunal
```

## 23.1 Initial Git History

Suggested progression:

### Commit 1

```text
chore: initialize Tribunal repository
```

Contains only the initial repository foundation such as `.gitignore` and a README skeleton.

### Commit 2

```text
docs: define project intent and conception
```

### Commit 3

```text
docs: add initial specification and architecture
```

### Commit 4

```text
chore: initialize application stack
```

This history should visibly demonstrate that conception and specification existed before substantial implementation.

---

# 24. Branch Strategy

`main` should always represent a verified, stable state.

Possible milestone branches:

```text
milestone/01-project-foundation
milestone/02-specification
```

Possible feature branches:

```text
feat/charge-sheet
feat/participant-config
feat/openrouter-client
feat/shared-model-mode
feat/multi-model-mode
feat/economics
```

Branches should be short-lived and merge only after verification.

---

# 25. Standard Workflow for Every Meaningful Change

Every non-trivial change should follow a repeatable engineering workflow:

```text
1. Intent
      ↓
2. Specification slice
      ↓
3. Clean Git checkpoint
      ↓
4. Branch
      ↓
5. Agent plan
      ↓
6. Human review of plan
      ↓
7. Execution
      ↓
8. Automated verification
      ↓
9. Independent review where appropriate
      ↓
10. Verification against specification
      ↓
11. Pull Request
      ↓
12. Merge gate
      ↓
13. Merge to main
      ↓
14. Record evidence
```

This should make the repository history itself part of the audit trail.

---

# 26. GitHub Issues

Use GitHub Issues for milestones and significant work items.

Suggested issue structure:

```markdown
## Intent

## Scope

## Acceptance Criteria

## Out of Scope

## Verification

## Dependencies
```

Issues help preserve what was intended before the code changed.

---

# 27. Pull Requests

Every significant feature should go through a PR.

Suggested `.github/PULL_REQUEST_TEMPLATE.md` structure:

```markdown
## Intent

## Specification

## What Changed

## What Did Not Change

## Verification

## Evidence

## Risks

## Screenshots

## Follow-ups
```

PR descriptions should provide evidence, not merely claim that a task is complete.

---

# 28. Main Branch Protection

Once CI is configured, protect `main`.

Recommended rules:

- No direct pushes
- Pull Request required
- Required CI checks
- Merge only after successful verification

The guiding rule is:

> **No gate, no merge.**

---

# 29. Continuous Integration

Initial GitHub Actions pipeline:

```text
install
  ↓
lint
  ↓
typecheck
  ↓
tests
  ↓
build
```

Later add security-oriented checks such as secret scanning when appropriate.

---

# 30. Verification Strategy

Do not rely on an agent reporting that the work is complete.

## 30.1 Unit Tests

Examples:

- Majority vote
- Budget calculation
- Token-cost calculation
- Charge Sheet validation
- Personality validation
- Model-output schema validation
- File validation
- Verdict validation

## 30.2 Integration Tests

Use mocked OpenRouter responses to verify the Tribunal workflow.

Test that:

- Exactly four advocate calls occur
- Exactly three judge calls occur
- Judges receive all four speeches
- Shared Model mode uses one configured model
- Multi-Model mode uses participant-specific models
- Economics data is aggregated correctly
- A failed phase does not silently proceed

## 30.3 End-to-End Tests

Typical user flow:

```text
Create Case
  ↓
Configure Tribunal
  ↓
Run Deliberation
  ↓
Receive Protocol
  ↓
View Economics
  ↓
Reopen Case from History
```

## 30.4 Manual Acceptance

For significant milestones, manually compare the implemented result against the written acceptance criteria.

---

# 31. Independent Verification

For meaningful changes, avoid having only the same agent both implement and approve its own work.

Preferred pattern:

```text
Agent A / Codex
      ↓
Implementation
      ↓
Fresh Agent / Reviewer
      ↓
Review Against SPEC
      ↓
Human Final Gate
```

Where possible, the reviewer should receive the specification and evidence rather than simply trusting the implementation agent's explanation.

---

# 32. Milestone Plan

## Milestone 0 — Repository Bootstrap

### Goal

Create the project foundation without product implementation.

### Deliverables

- Local Git repository
- GitHub repository
- `.gitignore`
- README skeleton
- `.env.example`
- Initial branch strategy
- Clean initial commit

### Product code

None or nearly none.

---

## Milestone 1 — Project Conception

### Deliverables

```text
INTENT.md

docs/conception/problem-statement.md
docs/conception/stakeholders.md
docs/conception/definition-of-done.md
docs/conception/out-of-scope.md
docs/conception/assumptions.md
```

### Goal

Make project purpose, users, constraints, boundaries, and completion criteria explicit before implementation.

---

## Milestone 2 — Specification and Architecture

### Deliverables

```text
SPEC.md
ARCHITECTURE.md
ROADMAP.md
AGENTS.md
CLAUDE.md
SECURITY.md
docs/ui-spec.md
docs/economics.md
```

### Goal

Turn the project concept into a testable, reviewable engineering plan.

---

## Milestone 3 — Application Skeleton

### Deliverables

- React + TypeScript application
- Routing
- Backend skeleton
- Supabase setup
- Environment configuration
- CI

### Verification

```text
lint       PASS
typecheck  PASS
tests      PASS
build      PASS
```

---

## Milestone 4 — UI Shell

### Goal

Implement the complete user flow with mock data before connecting any AI models.

### Screens

- New Case
- Advocates
- Judges
- Review
- Deliberation
- Result
- History

### Why first?

This validates the interaction model and information hierarchy before model integration adds cost and complexity.

---

## Milestone 5 — Case Persistence and File Input

### Deliverables

- Create case
- Save case
- Retrieve case
- Manual Charge Sheet input
- File Charge Sheet input
- Manual personality input
- File personality input

### Validation

- Allowed extensions
- Maximum file size
- Empty file
- Unsupported type
- Missing required content

---

## Milestone 6 — Participant Configuration

### Deliverables

Exactly:

```text
2 PRO Advocates
2 CON Advocates
3 Judges
```

Each participant supports:

- Role
- Side if applicable
- Personality
- Model assignment

### Goal

Finalize the participant data model before real AI execution begins.

---

## Milestone 7 — OpenRouter Infrastructure

### Deliverables

- OpenRouter client
- Server-side API key handling
- Model catalog/configuration
- Pricing retrieval or configuration
- Usage accounting
- Timeout handling
- Error handling
- Structured-response validation

### Verification

Perform one minimal controlled model call and verify usage/cost metadata.

---

## Milestone 8 — Shared Model Tribunal

### Goal

Implement the first complete working Tribunal.

### Flow

```text
1 shared model
      ↓
4 personality-based advocate calls
      ↓
4 speeches
      ↓
3 personality-based judge calls
      ↓
3 verdicts
```

### Expected baseline

Exactly seven model calls for a successful run.

---

## Milestone 9 — Multi-Model Tribunal

### Goal

Allow individual model assignment per participant without replacing the orchestration architecture.

### Success condition

The same Tribunal workflow works with participant-specific model configuration.

---

## Milestone 10 — Protocol and Economics

### Deliverables

- Full protocol
- Advocate speeches
- Judge reasoning
- Three verdicts
- Deterministic majority result
- Input tokens
- Output tokens
- Pricing snapshot
- Cost per call
- Total cost
- Latency
- $5 hard-ceiling enforcement

---

## Milestone 11 — Past Cases and Auditability

### Deliverables

```text
Past Cases
    ↓
Case
    ↓
Tribunal Run
    ↓
Protocol
    ↓
Economics
```

A historical run should remain understandable without repeating the model calls.

---

## Milestone 12 — Agent Mode, If Confirmed

### Goal

Implement a genuinely distinct agent-based execution strategy only if required by the course.

### Constraint

Do not label ordinary model calls as agents.

The implementation must explicitly demonstrate what makes the agent behavior different.

---

## Milestone 13 — Failure and Security Hardening

Test intentionally broken conditions:

- OpenRouter timeout
- Invalid JSON
- Missing speech
- Missing verdict
- File too large
- Unsupported file type
- Network error
- Invalid model
- Provider unavailable
- Budget exceeded
- Prompt-injection-like input

### Goal

Every failure must have an explicit, observable, safe result.

---

## Milestone 14 — UI Polish

Improve the existing working flow rather than redesigning behavior.

Focus on:

- Typography
- Spacing
- Responsive behavior
- Loading states
- Progress indicators
- Cards
- Information hierarchy
- Empty states
- Error states
- Mobile usability
- Subtle motion

---

## Milestone 15 — Deployment

### Deliverables

- Production database
- Production secrets
- Production deployment
- HTTPS
- Smoke testing
- At least one real deployed Tribunal run

---

## Milestone 16 — Final Verification and Course Audit

Audit the project as if viewed by the instructor.

Review:

- Intent
- Specification
- Architecture
- Repository history
- Issues
- Branches
- Commits
- Pull Requests
- CI
- Tests
- Deployment
- Secrets
- Prompt versions
- Economics
- UI
- Failure paths
- Verification evidence

Final question:

> Can every important claim about how this project was engineered be independently verified from the repository?

---

# 33. Final Definition of Done

The finished project should satisfy all of the following.

## Input and Configuration

- [ ] Charge Sheet can be written manually.
- [ ] Charge Sheet can be uploaded as a supported file.
- [ ] There are exactly two PRO advocates.
- [ ] There are exactly two CON advocates.
- [ ] There are exactly three judges.
- [ ] Every participant has an independent personality.
- [ ] Every personality can be written manually.
- [ ] Every personality can be loaded from a supported file.

## Deliberation

- [ ] Every advocate receives the Charge Sheet.
- [ ] Every advocate receives the correct side.
- [ ] Every advocate receives the correct personality.
- [ ] Every advocate produces a speech.
- [ ] Every judge receives the Charge Sheet.
- [ ] Every judge receives all four speeches.
- [ ] Every judge receives the correct personality.
- [ ] Every judge produces a verdict.
- [ ] Every judge produces reasoning.
- [ ] The system displays all four speeches.
- [ ] The system displays all three verdicts.
- [ ] The system displays all three reasoning protocols.
- [ ] Majority result is calculated deterministically.

## Execution Modes

- [ ] Shared Model mode works.
- [ ] Multi-Model mode works.
- [ ] Architecture can accommodate a future Agent execution strategy.
- [ ] Agent Mode, if required, is implemented as a genuinely distinct strategy.

## OpenRouter and Security

- [ ] OpenRouter is the model gateway.
- [ ] API keys never reach the frontend.
- [ ] Secrets are never committed.
- [ ] `.env.example` contains no real secret values.

## Cognified Software Economics

- [ ] Every call is recorded.
- [ ] Input tokens are recorded.
- [ ] Output tokens are recorded.
- [ ] Total tokens are recorded.
- [ ] Token pricing is recorded.
- [ ] Pricing snapshot is retained.
- [ ] Cost per call is recorded.
- [ ] Total run cost is recorded.
- [ ] Latency is recorded.
- [ ] The configured hard run budget is enforced.
- [ ] Free/cheap models are preferred when practical.

## Reliability

- [ ] Advocate calls run in parallel.
- [ ] Judge calls run in parallel after advocate completion.
- [ ] Model responses are structurally validated.
- [ ] Errors never become default verdicts.
- [ ] Model/provider failures are visible.
- [ ] Budget failures are visible.

## Persistence and Auditability

- [ ] Past cases are stored.
- [ ] Past runs can be reopened.
- [ ] Historical protocol can be inspected.
- [ ] Historical economics can be inspected.
- [ ] Prompts are version controlled.
- [ ] Important architecture decisions are documented.

## Engineering Process

- [ ] `INTENT.md` exists and is current.
- [ ] `SPEC.md` exists and is current.
- [ ] `ARCHITECTURE.md` exists and is current.
- [ ] `AGENTS.md` exists and is current.
- [ ] `CLAUDE.md` exists and is current.
- [ ] `README.md` is complete.
- [ ] `SECURITY.md` exists.
- [ ] Roadmap and milestones are documented.
- [ ] Git history is meaningful.
- [ ] Significant work uses branches.
- [ ] Significant work uses Pull Requests.
- [ ] CI is active.
- [ ] Tests exist.
- [ ] Main remains stable.
- [ ] Every milestone contains verification evidence.
- [ ] The application is deployed.
- [ ] The UI is minimal in complexity but visually polished.

---

# 34. Explicit Anti-Patterns to Avoid

Do **not**:

- Ask Codex to build the entire project in one giant prompt.
- Create one enormous final commit containing the whole project.
- Write documentation after the fact and present it as prior planning.
- Allow agents to silently invent requirements.
- Put the OpenRouter key in browser code.
- Commit real secrets.
- Use an LLM to calculate the majority vote.
- Use expensive models without justification.
- Call seven ordinary API calls a multi-agent system unless they truly meet the required agent definition.
- Merge code simply because it “works locally.”
- Treat tests written by the implementation agent as the only verification evidence.
- Add UI features that do not serve the user flow or course requirements.
- Hide failures behind default values.
- Allow silent paid-model fallback that can violate the budget.

---

# 35. Recommended Starting Sequence

Do not begin by implementing the Tribunal itself.

Use this order:

```text
STEP 1
Create local project + Git repository

      ↓
STEP 2
Create GitHub repository

      ↓
STEP 3
Create first clean commit

      ↓
STEP 4
Write and approve INTENT.md

      ↓
STEP 5
Write conception documents

      ↓
STEP 6
Write and approve SPEC.md

      ↓
STEP 7
Write ARCHITECTURE.md

      ↓
STEP 8
Write AGENTS.md + CLAUDE.md

      ↓
STEP 9
Create ROADMAP.md + GitHub Issues

      ↓
STEP 10
Initialize application code
```

The Git history should make it obvious that project conception and engineering decisions existed before significant code generation.

---

# 36. Repository Story We Want to Tell

At the end of the project, the repository should allow an evaluator to reconstruct the complete engineering story:

> Here is the intent.
> Here is the specification derived from it.
> Here are the assumptions that were identified and resolved.
> Here is the architecture and why it was selected.
> Here is the milestone sequence.
> Here is what the development agents were instructed to do.
> Here is what they actually changed.
> Here is how each important change was verified.
> Here is the Git history and Pull Request trail.
> Here are the runtime model calls.
> Here are the token counts, prices, costs, latency, and failures.
> Here is the deployed product.

The final goal is therefore not merely to produce a working Tribunal.

The goal is to produce **a working, attractive, auditable cognified application and a repository that proves disciplined Agentic Software Engineering was used to build it.**

---

# 37. Immediate Next Step

The next implementation action should be **Milestone 0 only**:

1. Create the local project directory.
2. Initialize Git.
3. Create the GitHub repository.
4. Add the minimal repository foundation.
5. Make the first clean commit.
6. Stop before application implementation.

After Milestone 0, write and approve `INTENT.md` before allowing Codex or Claude Code to begin substantial implementation.
