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

- **Home**
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

## 4A. Home Surface & Jon Snow Demo (Milestone 12)

`/` is a small Home surface, not a redirect straight into New Case (M12 planning: [Issue #32](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/32); demo economics/access corrected by a later human product override, PR #34, superseding the BYOK-gated design Issue #32 originally recorded). It exposes exactly three actions and nothing else:

- **Create / New Tribunal** — the existing Core User Flow above, unchanged.
- **Past Cases** — the existing history flow, unchanged.
- **Featured: Jon Snow Demo** — a themed card with two explicit actions: primary **Run Jon Snow Demo**, secondary **Modify settings / models** (links to `/demo/jon-snow`).

The Jon Snow demo is **operator-funded**, not BYOK (`SECURITY.md` §3.1.1) — this is a deliberate, narrow exception scoped to exactly this one surface; every other completion-capable flow in this document (Convene on Screen 4, Smart Import) is unchanged and still requires the user's own connected OpenRouter credential.

**Home's primary action ("Run Jon Snow Demo")** is a true one-click launch: when a lecturer access capability is present (captured once from a prepared presentation link's URL fragment into `sessionStorage`, never typed or shown) and the configured default model is currently eligible and within the demo's own cost ceiling, clicking it submits the canonical preset directly to the dedicated demo endpoint and navigates straight to the themed run route — no intermediate page, no confirmation step, no credential field of any kind. Without a capability, or with an ineligible/over-ceiling default, the action is disabled with a concise explanation directing to Modify settings / models; there is no silent fallback to a different or costlier model. Concise cost context is always shown on the card: default model name, 7 expected logical calls, the live conservative discovery estimate, and the operator-funded ceiling — sourced entirely from the existing eligible-model metadata endpoint, never computed in browser code.

**`/demo/jon-snow` ("Modify settings / models")** is the detail/customization screen: the full canonical case, all seven seats, the dossier's own global disclaimer, and a model chooser restricted to models that are both currently eligible and within the demo's cost ceiling — an over-ceiling model is omitted from the list entirely, never shown disabled. It carries no OpenRouter credential field; the demo is operator-funded, so there is nothing for the lecturer to connect here. Running from this screen uses the exact same dedicated demo endpoint and shared idempotent-submission primitive as Home's one-click path.

On launch (from either surface), the result renders on **`/demo/jon-snow/runs/:runId`** — a themed run route that reuses the Deliberation/Result screens' own data and logic (§11, §14) unmodified, wrapped only in a presentational GoT layer (naming, imagery, color accents). Game-of-Thrones theming is confined to the Home page's Jon Snow card, `/demo/jon-snow`, and this themed run route — nowhere else. The generic `/runs/:runId` (reached from History, Case Detail, or any direct link, including a later reopen of this same run) always renders the unthemed, Tribunal-generic presentation. Which of the two a given run shows is decided solely by which fixed route was used to reach it — the launcher always links to the themed route, History/Case Detail always link to the generic one — never by inspecting the run's own content (no defendant-name or other content-based detection).

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
  -> Connect OpenRouter (paste-your-key BYOK panel, corrected this pass
     -- product/economics decision: the developer/operator spends $0 on
     runtime inference; extraction is charged to the USER's own
     OpenRouter account. Visible immediately, connectable any time
     before Confirm & Extract; "Check Eligibility & Cost" below needs no
     connection at all, since it makes zero completion calls. Full
     detail: docs/economics.md Sec 22.1, SECURITY.md Sec 3.1.)
  -> Upload / Paste dossier
  -> [client-side type/size check]
  -> read-only quote (zero spend -- shows eligibility/estimated cost;
     works with or without a connected OpenRouter credential)
  -> explicit "Confirm & Extract" (disabled until OpenRouter is
     connected; this is where spend can occur, charged to the
     connected user's own account -- the server re-checks
     eligibility/budget fresh, never trusting the quote shown above,
     and independently rejects a missing credential with
     OPENROUTER_NOT_CONNECTED regardless of what the UI shows)
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

`UNKNOWN_OUTCOME` (Decision 13/16 -- the application lost authoritative
knowledge of whether a claimed provider attempt actually completed) is
a distinct message from an ordinary timeout: it must say plainly that
the outcome could not be confirmed, not imply a normal retryable
failure. A Retry action may still be offered after an `UNKNOWN_OUTCOME`
on the *first* attempt; after the *second*, no Retry is offered -- the
UI instead offers to start a fresh extraction (a new, separately
billable attempt, going through the read-only quote and confirmation
again).

**New this pass (final independent review, prompt-version resolution
audit): `PROMPT_VERSION_UNAVAILABLE` (Decision 7/16) is an
application-side unavailability, not something the user's dossier or
Retry action caused.** If a Retry cannot resolve the historical prompt
its original attempt used, the UI must say so plainly (e.g. "this
extraction attempt can't be retried right now -- please start a new
extraction") rather than implying a dossier problem or offering a
misleading "try again" that would repeat the same unresolved state.
The UI's recovery path is the same one already offered after a
terminal `UNKNOWN_OUTCOME` on attempt #2: start a fresh extraction
(new `extractionRequestId`, through the read-only quote and
confirmation again), never a bespoke workaround.

**Corrected in the fourth pass (final independent review, Decision
13/15): a lost network response after a successful extraction must
never present as data loss.** If the connection between the browser
and the server
drops after the server has already extracted and validated a draft
(the request appears to fail client-side, e.g. as a network error or a
stalled "Extracting" state), re-submitting the same request (retrying
the action, or simply reloading and re-entering the flow with the same
in-progress extraction) recovers the exact same validated draft and
warning summary with **no additional charge** — the server replays the
persisted, re-validated result rather than calling the provider again.
The UI does not need bespoke "did my request actually work?" messaging
for this case; it behaves exactly like a normal successful extraction
reaching the Extraction Review screen, just arriving on a later
attempt.

The same privacy notice shown before Charge Sheet entry (below) must
also be shown before dossier upload/paste — free-form dossier text is
at least as likely to carry incidental personal information.
**Corrected this pass (final independent review, security/idempotency
audit, `SECURITY.md` §15): the Smart Import notice must say more than
the base "do not submit sensitive data" line.** It must explicitly
disclose all four of the following before the user uploads/pastes:

1. The raw dossier and its normalized text are **not retained** past
   the extraction attempt that processed them.
2. The **validated, structured extraction result** produced from it
   **may be retained** to support recovering it after a lost response
   and for audit — even before the user presses "Apply extracted
   draft" or convenes the Tribunal.
3. **V1 has no accounts or login** (unchanged from the rest of this
   spec, §3/§15 below) and therefore no private per-user ownership
   guarantee for that retained result — it is not made private merely
   because the raw dossier itself is discarded.
4. Do not submit sensitive, private, confidential, or personally
   identifying material — the existing base rule, unchanged.

**Also corrected this pass: nothing in the Smart Import flow may imply
a logged-in session, "my extractions," or any form of private
ownership** — Smart Import, like every other V1 flow, is a shared
single-tenant demo surface, not an authenticated one.

**New this pass (final independent review, security/idempotency
audit): a source that starts too many fresh Smart Import extractions
in a short window is rate-limited, not silently queued or
substituted.** If the server rejects a new "Confirm & Extract" attempt
with `RATE_LIMITED` (`docs/adr/0004-smart-package-extraction.md`
Decision 16/19), the UI shows a clear "please try again shortly"
message, distinct from a budget block or any extraction-content
failure — it must not be presented as if the dossier itself was
rejected. This limit applies only to **starting a new** extraction; it
never blocks retrying/recovering an extraction already in progress or
already completed (an already-open Extraction Review, or a Retry on an
existing attempt, is unaffected by this limit).

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

PRO and CON should be visually distinguishable, but side meaning must also be written in text and never depend on color alone. Locked canonical meaning (`SPEC.md` §2.2): PRO = Defense (supports the defendant, argues NOT_GUILTY); CON = Opposition/Prosecution (argues GUILTY). Suggested current-setup card copy:

```text
PRO — Defense
Supports the defendant · argues NOT_GUILTY

CON — Opposition
Argues against the defendant · argues GUILTY
```

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

## 11A. Participant identity — a global rule (human product decision, PR #34)

Applies everywhere an individual real-run participant is identified: the Deliberation screen above (§11), the Completed Result screen (§14), and any Economics/Audit or Protocol surface that names a specific participant. Not specific to any one case or demo.

**Rule:** whenever a real Tribunal participant has a persisted, non-empty `profileName`, participant-facing UI presents that `profileName` as the primary human identity, with the participant's structural seat (e.g. "PRO I", "Judge I") as secondary context — never dropped, never duplicated as a second identical line. A participant with no meaningful `profileName` (null, empty, or whitespace-only) falls back to the structural seat alone, exactly as historical runs predating this rule already rendered.

Example (live Advocate card):

```text
David Cohen
PRO I
Supports the defendant · argues NOT_GUILTY
Running
```

Example (no profile name set — unchanged fallback):

```text
PRO I
Supports the defendant · argues NOT_GUILTY
Running
```

The existing prompt-version-aware side meaning (advocate-v1/advocate-v2 historical display) is unaffected and remains authoritative on its own — this rule only changes which text is primary versus secondary above it, never the side-meaning text itself.

**The secondary/fallback identity is always the human structural seat label** ("PRO I", "Judge I", …) — never the raw technical `participantId` ("advocate-pro-1", "judge-1"). This applies uniformly to every surface covered by this rule, including the Attempt Audit table and the Protocol's Advocates/Judges/Frozen Participants lists; the raw `participantId` may still appear in a clearly-labeled technical-detail context (e.g. an expanded per-attempt detail panel) where it is useful, but never as the visible primary or secondary participant identity.

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
