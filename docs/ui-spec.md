# The Tribunal — UI Specification

> **Design direction:** Modern Digital Courtroom
> **Guiding principle:** Minimal interaction, polished presentation.
> **Scope:** User flow, information hierarchy, interaction, feedback, bad states, responsive/accessibility expectations.

## 1. Design Objective

The interface should teach its own use.

A first-time visitor should understand:

- what case information to provide
- that four advocates will argue opposing sides
- that three judges will independently decide
- which model configuration is being used
- when AI work is running or retrying
- whether the Tribunal completed or failed
- what the majority verdict is
- what the run consumed in tokens, money, and time

The product should feel like one coherent digital deliberation, not seven chatbot cards.

---

## 2. Visual Direction

Use a restrained, contemporary courtroom-inspired system rather than literal decoration.

Desired qualities:

- spacious layout
- strong typographic hierarchy
- high legibility and contrast
- clean cards/surfaces
- restrained borders/dividers
- subtle motion
- calm, serious tone
- clear PRO/CON distinction without aggressive color coding
- responsive desktop/mobile design

Avoid:

- gavels, wigs, courthouse clip art, scales-of-justice gimmicks
- emoji as primary status language
- excessive gradients/glow
- dense dashboard-style controls
- decorative animation that delays reading
- forcing all content into one enormous page

Exact colors, fonts, radii, and pixel values are intentionally left to implementation/design review.

---

## 3. Global Application Structure

Primary navigation should remain small:

- **New Case**
- **Past Cases**
- project/product title

There is no V1 login/profile navigation.

A persistent or contextual note should make clear that this is an educational AI deliberation, not legal advice.

The public-demo privacy warning should be visible before a run is convened.

---

## 4. Core User Flow

```text
New Case
   ↓
1. Charge Sheet
   ↓
2. Advocates
   ↓
3. Judges
   ↓
4. Review
   ↓
Convene Tribunal
   ↓
5. Deliberation
   ↓
6. Result
   ↓
Past Cases / Reopen
```

The setup flow may be presented as steps/tabs/routes, but the user should always know:

- current step
- completed prior steps
- what remains before spending money

Back navigation before run start should preserve valid setup state.

Once execution begins, historical run configuration is frozen.

---

## 5. Screen 1 — Charge Sheet

### Purpose

Collect the disputed case with minimal ambiguity.

### Required fields

- Defendant
- Act
- Exact Question

Each field includes:

- clear label
- concise helper text only where useful
- remaining/maximum length feedback when approaching the limit
- inline validation state

### Input method

Allow either:

- manual text entry
- supported `.txt` / `.md` import
- strict structured Full Tribunal Package import
- Smart Import (Milestone 7A — free-form dossier extraction, below)

Import is a convenience, not a separate case type. After successful import, the normalized three fields become visible/editable before continuing.

Charge Sheet import fills only the three case fields. Full Tribunal Package import fills the case plus all seven participant profile names/personalities, preserves application-owned execution/model configuration, and navigates to Review.

Full Tribunal Package import must never automatically convene the Tribunal.

### Smart Import (Milestone 7A)

A third import method, for a free-form dossier that isn't structured
with `[SECTION]`/`FIELD:` markers. Full contract:
`docs/adr/0004-smart-package-extraction.md`.

```text
New Case
  -> Smart Import
  -> Upload / Paste dossier
  -> [client-side type/size check]
  -> read-only quote (zero spend -- shows eligibility/estimated cost)
  -> explicit "Confirm & Extract" (this is where spend can occur; the
     server re-checks eligibility/budget fresh, never trusting the
     quote shown above)
  -> Extracting
  -> Extraction Review (staged preview -- does not touch the active draft)
       - unresolved/ambiguous fields visibly highlighted
       - all fields editable
       - warning summary visible
       - source filename/type visible
       - extraction model/version visible at a secondary, collapsible
         audit-detail level
       - estimated cost (pre-attempt) and actual cost (post-attempt) --
         if a Retry occurs, the running total across both attempts is
         shown against the $0.50 extraction ceiling, not a per-attempt
         figure in isolation -- both always clearly separate from the
         Tribunal run's own cost
       - "Apply extracted draft" / "Cancel" (Cancel preserves whatever
         draft existed before Smart Import was opened)
  -> existing setup Review (same screen imported/manual drafts already use)
  -> explicit Convene Tribunal (unchanged; never automatic)
```

Failure states use the exact reason codes
`docs/adr/0004-smart-package-extraction.md` Decision 16 defines,
surfaced in plain language, with a "Retry" action when the failure is
retryable and an "edit and try again" path otherwise. At most one
Retry is ever offered per extraction attempt (2 provider attempts
total per logical extraction) -- the server, not the client, decides
whether Retry is available. The UI resends the same dossier content
the user already provided when Retry is pressed -- the user is never
asked to re-upload/re-paste.

The same privacy notice shown before Charge Sheet entry (below) must
also be shown before dossier upload/paste — free-form dossier text is
at least as likely to carry incidental personal information.

Smart Import must never automatically convene the Tribunal, and must
never silently overwrite a draft already in progress before the user
explicitly presses "Apply extracted draft."

### File error states

Show specific failure, for example:

- unsupported file type
- file too large
- invalid text encoding
- missing `QUESTION:` section
- duplicate section marker
- missing `[JUDGE_2]` package section
- unknown package section such as `[PRO_3]`
- unsupported package field such as model/provider assignment

Do not display “Something went wrong” when the validation reason is known.

### Primary action

`Continue to Advocates`

Disabled or blocked while required fields are invalid.

---

## 6. Screen 2 — Advocates

### Purpose

Configure the four fixed advocates without making participant count feel editable.

Display four clear participant cards:

```text
PRO I     PRO II
CON I     CON II
```

On smaller screens, cards stack while preserving order/grouping.

### Each card shows

- participant label
- fixed side
- optional profile name
- personality input
- manual / upload personality option
- validation feedback
- model assignment only when Separate-Model Mode makes it relevant

Personality text should have enough space to write meaningful behavioural context; avoid tiny single-line inputs.

### Side clarity

PRO and CON should be visually distinguishable, but side meaning must also be written in text and never depend on color alone.

### Primary action

`Continue to Judges`

---

## 7. Screen 3 — Judges

Display three judge cards together where desktop width permits:

```text
Judge I    Judge II    Judge III
```

Each contains:

- participant label
- optional profile name
- personality input/manual-upload control
- model assignment in Separate-Model Mode
- validation state

Do not add judge “special powers” or controls not defined in specification.

Primary action:

`Review Tribunal`

---

## 8. Execution Mode Interaction

Execution mode must be understandable before individual model selection becomes confusing.

Supported modes:

### Shared Model

One model selector applies to all seven participants.

Explain concisely:

> One model, seven distinct roles and personalities.

Do not show seven redundant model dropdowns in this mode.

### Separate Models

Each participant card exposes its own model selector.

Explain concisely:

> Each participant can use a different eligible OpenRouter model.

If mode changes from Separate → Shared, preserve personalities but replace model assignments according to an explicit predictable rule (for example require choosing the shared model). Do not silently choose an expensive model.

---

## 9. Model Selection

Model selectors should show useful decision information without becoming an OpenRouter admin console.

Per option, prefer:

- model name
- provider/model ID where useful
- Free badge when currently free
- concise prompt/output price summary when paid

Default sorting should make free/low-cost eligible models easy to find.

Models not compatible with the Tribunal's structured-output/context/economics requirements should not appear as selectable options.

Never show stale pricing as guaranteed current billing. Review preflight is authoritative.

---

## 10. Screen 4 — Review

This is the last human gate before cost-bearing execution — true from
Milestone 8 onward, once real Tribunal execution exists. See "Milestone 6
transitional behavior" below for what Convene does before then.

### Information hierarchy

1. **Case summary** — Defendant, Act, Exact Question
2. **Execution mode**
3. **Seven participant configuration summary**
4. **Selected model(s)**
5. **Economics preflight**
6. **Retention/privacy warning**
7. Primary action

### Economics preflight card

Show clearly:

- expected logical calls: **7**
- retry policy: at most one retry per participant
- conservative estimated maximum model cost
- hard policy: **$5.00 maximum**
- eligible / blocked state

Suggested language:

> Estimated maximum is a conservative safety bound, not an exact charge.

If preflight cannot establish safe pricing, the action is blocked with explanation.

### Privacy notice

Before convening:

> This V1 course demo stores submitted cases in shared demo history. Do not submit sensitive, private, confidential, or identifying information.

This notice should not be buried in a footer.

### Import notice

After a successful Full Tribunal Package import, Review should clearly state:

> Imported Tribunal package — review all extracted fields before convening.

After a successful Smart Import extraction is applied (Milestone 7A),
Review should clearly state:

> Extracted from your dossier — review all fields, especially any marked as unresolved, before convening.

Review should show all fixed seats, optional profile names, personalities, and model/execution configuration. The user must be able to return and edit imported fields before explicit convening.

### Primary action

`Convene Tribunal`

The button must resist accidental duplicate activation while the start request is pending, but backend idempotency remains the real duplicate-spend control.

### Milestone 6 transitional behavior

Milestone 6 wires `Convene Tribunal` to a real, permanent configuration
freeze (`POST /api/runs`) with zero model calls — it does not yet begin a
deliberation, because no Tribunal execution engine exists until Milestone
8. On success:

- remain on the Review screen (no navigation to a deliberation route)
- show a clear, non-deceptive success state, for example:
  > Tribunal configuration frozen. Model execution is not enabled yet.
- optionally show the accepted run ID for debugging/audit
- show no fabricated advocate/judge/progress/result content of any kind

This note is removed once Milestone 8 ships real execution and Convene's
behavior matches "last human gate before cost-bearing execution" above
without qualification.

---

## 11. Screen 5 — Deliberation

Do not use a generic spinner as the only feedback.

The user should understand the phase and individual participant state.

### Advocate phase

Header example:

```text
The Tribunal is in session
Preparing arguments
```

Show all four:

```text
PRO I    Running
PRO II   Complete
CON I    Retrying
CON II   Waiting / Running
```

Status vocabulary at UI level:

- Waiting
- Running
- Retrying
- Complete
- Failed

Status must use text/iconography, not color alone.

### Barrier state

When all advocates succeed, communicate transition:

> All arguments received. The judges are now deliberating.

### Judge phase

Show three judges together:

```text
Judge I     Deliberating
Judge II    Complete
Judge III   Deliberating
```

### Navigation/refresh resilience

Because execution runs in the background, refreshing or returning to the run URL should recover state from the backend rather than restart the Tribunal.

The page may say that the user can leave and reopen while deliberation continues if that behaviour is verified in production.

---

## 12. Failure During Deliberation

Failure is a terminal, explicit state.

Do not replace the progress page with an empty result card.

Example:

```text
Tribunal could not complete

CON II did not return a valid argument after the permitted retry.
The judges were not started.

Partial model cost so far: $0.03
```

Or:

```text
Tribunal could not complete

Judge III failed after the permitted retry.
No majority verdict was calculated.
```

Actions may include:

- `Start a New Case`
- `Review Run Details`

Do not offer an automatic paid rerun without returning through normal review/preflight rules.

---

## 13. Budget Blocked State

`BLOCKED_BUDGET` is not a model error.

Example:

```text
This configuration cannot be convened

Conservative maximum model cost: $6.24
Run budget limit: $5.00

Choose cheaper eligible models before continuing.
```

No verdict, courtroom language implying deliberation, or participant failure should be shown because model execution never started.

---

## 14. Screen 6 — Completed Result

The information hierarchy is fixed by product intent.

### 14.1 Majority first

Top of result:

```text
TRIBUNAL VERDICT
GUILTY
```

or

```text
TRIBUNAL VERDICT
NOT GUILTY
```

Clearly label it as deterministic majority of the three judge votes, not a fourth AI opinion.

### 14.2 Three judge votes together

Immediately below, show all three side-by-side where possible:

```text
Judge I       Judge II       Judge III
GUILTY        NOT GUILTY     GUILTY
```

The user should see disagreement without opening three separate screens.

### 14.3 Judge reasoning

Then show three expandable/readable reasoning sections/cards.

Each includes:

- judge label
- personality summary/expandable detail
- model
- verdict
- full reasoning

Long reasoning must remain readable with sensible line length and spacing.

### 14.4 Advocate speeches

Below judge reasoning, group:

- PRO I
- PRO II
- CON I
- CON II

Each speech shows participant, side, model, personality detail, and full text.

### 14.5 Economics

Show a compact run summary, then expandable detailed attempt table.

Do not place a giant telemetry table above the verdict.

---

## 15. Economics Presentation

### Compact summary

Example:

```text
7 logical calls · 8 attempts
18,420 tokens · $0.17
7.4s wall clock
```

### Detailed table

Suggested columns:

| Participant | Attempt | Model | Input | Output | Total | Cost | Latency | Status |
|---|---:|---|---:|---:|---:|---:|---:|---|

Provide pricing-snapshot detail via expand/popover/details rather than overloading the first view.

For failed attempts with unavailable telemetry, show `Unavailable`, not zero.

For failed runs, label totals as **partial usage/spend**.

---

## 16. Screen 7 — Past Cases

### List view

Each entry may show:

- Defendant
- shortened Exact Question
- date/time
- source type

Before real Tribunal runs exist, stored cases must not fabricate execution mode, completed/failed run state, majority verdict, cost, speeches, reasoning, protocol, or model economics.

Do not show a verdict for failed runs.

### Empty state

```text
No cases yet
Convene your first Tribunal to create a history entry.
```

Primary action: `Bring a Case`

### Reopen

Opening a completed historical run presents the stored result/protocol/economics and must not imply fresh deliberation.

Use language such as:

> Historical run — model calls are not being repeated.

---

## 17. Form and Validation Feedback

Validation should be local, specific, and recoverable.

Good:

> Exact Question is required.

> Personality must be 4,000 characters or fewer.

Bad:

> Invalid input.

Server validation may return errors after client validation passes; display those honestly next to the relevant field/global gate.

Focus should move sensibly to the first invalid field after submission.

---

## 18. Loading and Network States

Distinguish at least:

- parsing uploaded file
- loading eligible models
- calculating preflight
- submitting/starting run
- advocate deliberation
- judge deliberation
- loading historical run

Do not reuse “AI is thinking…” for deterministic network/database operations.

If status polling temporarily fails, show connection/retry feedback without declaring the underlying Tribunal failed unless backend state says it failed.

---

## 19. Responsive Behaviour

### Desktop

- setup content centered with readable max width
- advocate 2×2 grid
- judge 3-column row where space allows
- three verdicts visible together
- detailed economics table can use horizontal space

### Tablet

- cards may become 2-column/stacked
- keep progress and verdict grouping coherent

### Mobile

- one-column setup cards
- sticky/obvious primary action where appropriate
- judge votes remain a compact grouped section even if stacked
- long speeches/reasoning have comfortable reading width
- tables may transform into stacked rows/cards rather than microscopic columns

No horizontal overflow for normal text content.

---

## 20. Accessibility Baseline

Implementation must provide:

- semantic headings in logical order
- associated labels for all fields
- keyboard-operable controls
- visible focus states
- sufficient contrast
- status information not encoded by color alone
- accessible error messaging
- accessible progress/status announcements where practical
- reduced-motion respect for nonessential animation
- meaningful button names

Do not use disabled controls without explaining why the next action is unavailable.

---

## 21. Motion

Motion should support state change, not spectacle.

Appropriate examples:

- subtle card/status transition
- progress-state change
- expandable reasoning/speech sections

Avoid:

- simulated typing for complete stored model output
- long courtroom animations before results
- bouncing/pulsing decorative elements
- motion that obscures terminal failure

---

## 22. Content Style

Voice should be concise, neutral, and serious without pretending legal authority.

Preferred terminology:

- Charge Sheet
- Advocate
- Judge
- Deliberation
- Tribunal Verdict / Majority
- Reasoning
- Protocol
- Model Cost

Avoid claims such as:

- “legally correct”
- “official judgment”
- “court-approved”

Include a concise non-legal disclaimer in an appropriate persistent or result context.

---

## 23. UI Acceptance Checklist

A milestone UI is not accepted until relevant items are true:

- [ ] stranger can identify the primary action without tutorial
- [ ] three Charge Sheet fields are obvious
- [ ] exactly four advocates and three judges are visually clear
- [ ] Shared vs Separate model behaviour is understandable
- [ ] review shows 7 calls, cost bound, and privacy warning
- [ ] deliberation shows participant-level state
- [ ] retry is visible
- [ ] failure cannot be mistaken for a verdict
- [ ] majority appears before detailed reasoning
- [ ] three judge votes appear together
- [ ] long reasoning/speeches remain readable
- [ ] economics summary does not dominate the verdict
- [ ] historical run is clearly historical and does not rerun models
- [ ] mobile layout remains usable
- [ ] keyboard/focus/labels/contrast have been manually checked
