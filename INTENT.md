# Project Intent

The Tribunal exists to let a user submit a disputed case and observe how multiple AI participants with different personalities and model configurations construct opposing arguments and reach independent, reasoned verdicts, while making the computational cost of that AI deliberation transparent.

The primary usefulness is to make AI deliberation observable.

The primary user is a curious user who wants to submit a debatable case and observe how differently configured AI participants argue and judge it.

The application is not real legal advice and has no legal authority.

## Core Conception

A Tribunal run has exactly seven AI participants:

- 2 PRO advocates
- 2 CON advocates
- 3 judges

Each participant has an independently configurable personality.

Each advocate receives the Charge Sheet, its assigned side, its personality, and base advocate instructions. Each advocate produces one speech intended to make the strongest case for its assigned side.

Each judge receives the original Charge Sheet, all four advocate speeches, the judge's personality, and base judge instructions. Each judge produces a verdict and reasoning supporting the verdict.

The application exposes all four speeches, all three individual verdicts, all three judge reasonings, a deterministic majority result, a full protocol, and model-call economics. The deterministic majority must be calculated by ordinary application code, not by an additional model call.

## Execution Configurations

The Tribunal must support a Shared-Model Tribunal configuration, where one selected LLM is used for all seven participants. The participants remain distinct through role, side, personality, and context.

The Tribunal must also support a Separate-Model Tribunal configuration, where each participant may be configured with a different LLM.

Both configurations use OpenRouter as the model gateway.

A true agent-execution mode remains an unresolved future requirement until the course's oral guidance is confirmed more precisely.

## Economics

The final product must make the economics of each Tribunal run visible. Where available or reliably derivable, the observable data includes model used, input tokens, output tokens, total tokens, applicable input-token price, applicable output-token price, per-call cost, total run cost, and latency.

Model selection should prefer free or very low-cost models because the educational goal is not maximum model performance. A complete Tribunal run has a hard model-cost ceiling of `$5 USD`, with a design target substantially below that ceiling whenever possible. No automatic fallback may silently violate this budget.

## UX Principle

Minimal interaction, polished presentation.

The intended product should be clear, modern, organized, responsive, and visually polished without introducing unnecessary controls or features. Detailed visual design choices belong to later milestones.

## Success Statement

The project succeeds when a user can submit one case, configure seven distinct AI participants, run the case using either a shared or individually selected model configuration, inspect the four arguments and three reasoned verdicts, and understand exactly how many model resources and how much money were consumed to produce that deliberation.
