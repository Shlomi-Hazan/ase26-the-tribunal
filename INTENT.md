# Project Intent

## 0. Document Purpose

This file is the source-of-truth product intent for The Tribunal. It should be read before substantial planning, specification, architecture, or implementation work.

It records human-approved product direction and must not be silently reinterpreted by coding agents. It is a living document: major product-direction changes should update intent before implementation begins.

The repository should demonstrate Agentic Software Engineering through explicit specifications, plans, verification, Git history, and auditability.

This document is not the detailed implementation specification. Detailed checkable requirements belong in future specification documents.

## 1. Working Project Name

Working name: `The Tribunal`

Course: `Agentic Software Engineering (ASE-26)`

One-line description: An AI-powered web application in which advocates with distinct personalities argue opposing sides of a submitted case, independent AI judges produce reasoned verdicts, and the application exposes the token, cost, and latency economics of the entire deliberation.

Short product pitch: The Tribunal lets a curious user convene a structured AI deliberation, compare how distinct advocates and judges reason about the same disputed case, and see what the deliberation cost in model resources.

## 2. Primary Intent - Why This Project Exists

The Tribunal exists to let a user submit a disputed case and observe how multiple AI participants with different personalities and model configurations construct opposing arguments and reach independent, reasoned verdicts, while making the computational cost of that AI deliberation transparent.

The central usefulness is to make AI deliberation observable.

A normal single-LLM answer collapses disagreement into one response. The Tribunal intentionally exposes:

- competing arguments
- personality effects
- independent judgements
- model configuration effects
- reasoning
- variability
- runtime cost

The core idea is not merely "an AI courtroom UI." The product exists to make AI disagreement, judgement, and economics inspectable inside one coherent run.

## 3. The User Problem

The primary user is a curious user who wants to submit a debatable case and observe how differently configured AI participants argue and judge it.

The experience addresses several related problems:

- a single AI answer hides competing perspectives
- personality/system prompting effects are normally invisible
- model differences are difficult to observe in one coherent workflow
- reasoning paths are hidden when only a final answer is shown
- model-call cost and token consumption are usually invisible to the user

The application is educational and demonstrative. It has no legal authority and must not present itself as real legal advice.

## 4. Product Principles

### 4.1 AI Only Where Cognition Is Needed

Use models for:

- constructing arguments
- interpreting participant personalities
- evaluating opposing arguments
- producing reasoned verdicts

Use deterministic software for:

- form validation
- file validation
- persistence
- routing
- majority calculation
- token arithmetic
- cost arithmetic
- authorization if later required
- displaying stored results

Do not use an LLM for work ordinary code can perform more reliably.

### 4.2 Disagreement Is a Feature

The goal is not to force all participants toward one answer. Distinct personalities and model configurations should be allowed to produce different reasoning and verdicts.

### 4.3 Personality Must Materially Affect Participant Context

Each advocate and judge has independently configurable personality/system context. Personality is not merely a display label.

### 4.4 Failure Must Look Like Failure

A timeout, malformed response, missing verdict, or provider error must never be silently transformed into a default legal-looking result.

### 4.5 Economics Are Product Output

Token use, pricing, cost, and latency are part of the Tribunal result, not hidden developer telemetry.

### 4.6 Avoid Fake Complexity

Do not call ordinary model calls "agents" merely for appearance. A future true agent configuration should only be implemented if course requirements are clarified and the design genuinely adds agent behavior.

## 5. Core Tribunal Experience

The intended high-level experience is:

1. A user creates or provides a Charge Sheet.
2. The user configures four advocates.
3. The user configures three judges.
4. The user chooses the model execution configuration.
5. The user reviews the configuration.
6. The user convenes the Tribunal.
7. The user watches or receives the deliberation.
8. The user inspects arguments, verdicts, reasoning, protocol, and economics.
9. The user can later reopen persisted completed cases.

This is a product-level description. Exact pages, components, and flows belong to later specification and design work.

## 6. Participants and Roles

A run contains exactly seven AI participants:

- 2 PRO advocates
- 2 CON advocates
- 3 judges

### Advocates

Each advocate receives:

- original Charge Sheet
- assigned side
- independently configured personality
- base advocate instructions

Each advocate produces one persuasive speech for its side.

### Judges

Each judge receives:

- original Charge Sheet
- all four advocate speeches
- independently configured personality
- base judge instructions

Each judge produces:

- one verdict
- reasoning supporting that verdict

The three judges make independent decisions. The majority result is calculated deterministically from their verdicts.

## 7. Charge Sheet and Personality Inputs

The intended product supports both:

- manually written or pasted input
- supported uploaded files

This applies to:

- Charge Sheet
- advocate personalities
- judge personalities

Exact supported file formats remain a later specification decision.

## 8. Execution Configurations

### Shared-Model Tribunal

One selected LLM is used for all seven participants.

Participants remain behaviorally distinct through:

- role
- side
- personality
- context

### Separate-Model Tribunal

Each participant may be configured with a different LLM.

### Agent Execution

Course oral guidance has referenced a model-versus-agent distinction. A true agent-execution configuration remains unresolved until that requirement is confirmed more precisely.

Do not claim agent execution is implemented. Do not silently redefine ordinary model calls as agents.

## 9. Cognified Software Boundary

The Tribunal is cognified software because model calls perform core runtime work. The LLM is not merely a development tool; each Tribunal run invokes AI during use.

Relevant model-call characteristics:

- variable
- costly
- slow
- fallible

The desired boundary is clear: models perform argumentation, judgement, and reasoning. Deterministic application code performs validation, persistence, orchestration rules, arithmetic, majority calculation, and other predictable work.

## 10. OpenRouter and Model Strategy

OpenRouter is the intended model gateway.

The educational goal is not maximum model performance. Model choice should prefer:

- free models where practical
- otherwise very low-cost models

Model availability and pricing can change and therefore must be verified at implementation and runtime design time. Current model names should not be hard-coded into this intent document as permanent requirements.

## 11. Token Economics and Cost Budget

A complete Tribunal run must expose, where available or reliably derivable:

- participant
- model/provider
- input tokens
- output tokens
- total tokens
- applicable input price
- applicable output price
- per-call cost
- total run cost
- latency

Hard cost ceiling: `$5 USD per complete Tribunal run`

Design target: substantially below the ceiling, preferably as close to free as practical.

No automatic fallback may silently break the cost ceiling. Cost is an architectural constraint, not after-the-fact accounting.

## 12. Reliability and Failure Principles

The system must assume models can fail.

At intent level, the future design must account for:

- model timeout
- provider failure
- malformed model output
- missing advocate speech
- missing or invalid judge verdict
- unsupported or invalid uploaded input
- budget violation risk

Structured model outputs should be validated before being treated as valid application data.

Retries, exact schemas, and timeout values remain specification and architecture decisions.

## 13. Protocol and Result Philosophy

The final user-visible result should make the deliberation inspectable.

It should expose:

- four advocate speeches
- three judge verdicts
- three judge reasonings
- deterministic majority result
- protocol
- model-call economics

The majority must not require an additional model call.

For the full protocol, the current preferred direction is to assemble it from stored participant outputs rather than perform an eighth LLM call. This protocol-composition approach remains a later specification and architecture decision rather than a settled requirement.

This distinction must remain consistent with `docs/conception/assumptions.md`.

## 14. User Experience Principles

Guiding principle:

> Minimal interaction, polished presentation.

The app should feel:

- clear
- modern
- organized
- responsive
- visually deliberate
- easy to understand without a tutorial

Minimalistic does not mean visually unfinished.

The user should immediately understand:

- what to provide
- what the Tribunal is doing
- whether processing is still occurring
- when something failed
- what each judge decided
- what the run cost was

Do not specify colors, exact typography, component libraries, pixels, or final layouts here. Those belong to the future UI specification.

## 15. Persistence and Auditability

Completed cases should ultimately be persistable and reopenable.

A past completed run should retain enough data to understand:

- original case
- participant configuration
- speeches
- judge reasoning
- verdicts
- model configuration
- economics

Important prompts and model behavior definitions should be version controlled.

The repository itself should also preserve an understandable engineering audit trail through:

- intent
- specifications
- architectural decisions
- plans where useful
- commits
- branches
- pull requests
- verification evidence

## 16. Product Success Criteria

The project succeeds when a user can submit one case, configure seven distinct AI participants, run the case using either a shared or individually selected model configuration, inspect the four arguments and three reasoned verdicts, and understand exactly how many model resources and how much money were consumed to produce that deliberation.

Success does not mean merely demonstrating one happy-path model response. The finished course project should be inspectable, reliable enough to demonstrate, deployed, and repository-auditable.

Detailed target acceptance criteria are maintained in `docs/conception/definition-of-done.md`.

## 17. Out-of-Scope Summary

The initial product does not aim to provide:

- real legal advice or legal authority
- RAG/vector-database architecture
- model training/fine-tuning
- social-network functionality
- payments
- voice interaction
- image generation
- arbitrary participant counts
- unnecessary AI calls for deterministic operations
- maximum legal-reasoning performance

The full out-of-scope conception is maintained in `docs/conception/out-of-scope.md`.

## 18. Open Decisions

The following decisions remain unresolved:

1. Exact verdict vocabulary.
2. Exact supported upload formats.
3. Exact frontend framework.
4. Exact backend/runtime architecture.
5. Exact persistence/database approach.
6. Exact deployment platform.
7. Exact OpenRouter models used at runtime.
8. Whether any model pricing metadata is provider-reported versus locally derived.
9. Exact structured output schemas.
10. Retry and fallback strategy.
11. Timeout limits.
12. Maximum token limits per participant.
13. Exact preflight budget-control strategy.
14. Exact protocol composition implementation.
15. Whether authentication becomes necessary.
16. Whether a true agent-execution version is a distinct required course deliverable.
17. What model/tool/loop behavior would qualify that version as genuinely agentic.

Coding agents must not silently decide important unresolved product behavior. These decisions will be resolved through specification and architecture work.

## 19. Agentic Development Process

The project should itself demonstrate Agentic Software Engineering.

For meaningful development work, follow:

1. Intent
2. Specification
3. Context
4. Plan
5. Execution
6. Verification
7. Audit Trail

The human remains accountable for:

- product direction
- major trade-offs
- architecture judgement
- approving specifications
- reviewing plans
- verification
- accepting or rejecting work

Coding agents are collaborators and executors, not the owners of product intent.

## 20. Repository Documentation Strategy

Intended documentation roles:

- `INTENT.md` - product purpose and durable human-approved direction
- `docs/conception/` - conception artifacts and explicit assumptions
- future `SPEC.md` - precise testable system requirements
- future `ARCHITECTURE.md` - technical system structure and boundaries
- future `AGENTS.md` - repository rules for coding agents
- future `CLAUDE.md` - Claude-specific entry guidance
- future UI/economics/security documents - focused engineering specifications
- `README.md` - public project entry point, setup, demo, and high-level overview

Do not create those future files until their milestones authorize them.

## 21. Version Control Discipline

High-level project rules:

- small coherent commits
- meaningful branches for non-trivial work
- no secret commits
- prompts version controlled
- schema/migration changes version controlled when they later exist
- tests evolve with behavior
- no merge merely because an agent reports "done"
- verification precedes trust
- preserve project evolution clearly

Do not add CI or GitHub configuration until a later milestone authorizes it.

## 22. Prompt Management

Intent-level prompt principles:

- important runtime prompts are version-controlled
- participant personality is configurable context, not a substitute for base role instructions
- prompts are runtime behavior and must be reviewable
- machine-consumed outputs should prefer structured forms
- prompt changes are real behavioral changes and should be reviewed accordingly

Detailed prompt design belongs later.

## 23. Non-Negotiable Rules for Coding Agents

Coding agents working on The Tribunal must not:

- silently change product intent
- invent unresolved requirements
- expose secrets client-side
- use an LLM where deterministic code is clearly sufficient
- silently turn model failure into valid-looking output
- exceed or bypass the run-cost policy
- add fake agent complexity merely for naming or appearance
- change participant counts without an approved intent/spec change
- treat unverified model output as trusted application data
- merge work merely because it appears complete
- start later milestones without authorization

They should read relevant intent, specification, and context before substantial work and verify against written requirements before declaring completion.

## 24. Final Product Vision

The finished experience should feel like convening a real digital deliberation. The user submits a debatable case, configures distinct advocates and judges, watches opposing arguments emerge, sees judges disagree or agree for understandable reasons, inspects each verdict, sees the majority, and understands exactly what the AI deliberation consumed in tokens, money, and time.

The result should feel like one coherent product, not seven unrelated chatbot calls displayed on one screen.

## 25. Course Alignment Note

The project intentionally demonstrates course principles including problem framing before implementation, explicit specification, browser/backend/database/deployment separation, cognified runtime behavior, cost and latency awareness, context engineering, version control, verification before trust, auditability, and appropriate use of multi-model or future multi-agent orchestration.
