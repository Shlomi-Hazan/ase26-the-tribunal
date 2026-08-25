# Definition of Done

These are target acceptance conditions for the finished project. They do not describe the current repository state.

## Case Creation

- [ ] A user can enter a Charge Sheet manually.
- [ ] A user can provide a supported Charge Sheet file.
- [ ] Invalid or empty Charge Sheets are rejected visibly.

## Advocates

- [ ] A run contains exactly two PRO advocates.
- [ ] A run contains exactly two CON advocates.
- [ ] Each advocate has an independently configurable personality.
- [ ] Advocate personality can be entered manually.
- [ ] Advocate personality can be supplied from a supported file.
- [ ] Each advocate receives the same Charge Sheet.
- [ ] Each advocate produces one speech.

## Judges

- [ ] A run contains exactly three judges.
- [ ] Each judge has an independently configurable personality.
- [ ] Judge personality can be entered manually.
- [ ] Judge personality can be supplied from a supported file.
- [ ] Every judge receives the original Charge Sheet.
- [ ] Every judge receives all four advocate speeches.
- [ ] Every judge returns a valid verdict.
- [ ] Every judge returns reasoning.

## Results

- [ ] All four speeches can be inspected.
- [ ] All three verdicts are displayed together.
- [ ] All three judge reasonings can be inspected.
- [ ] A deterministic majority result is calculated from the three verdicts.
- [ ] No additional LLM call is required for majority calculation.
- [ ] Model failure is never silently converted into a verdict.

## Execution Configurations

- [ ] Shared-model mode works with one selected LLM for all seven participants.
- [ ] Separate-model mode permits individual model selection per participant.

## Economics

- [ ] Each model call records its model.
- [ ] Each model call records input tokens.
- [ ] Each model call records output tokens.
- [ ] Each model call records total tokens.
- [ ] Applicable token pricing is recorded or reliably derived.
- [ ] Each model call records cost.
- [ ] Each model call records latency.
- [ ] The run displays total token usage.
- [ ] The run displays total cost.
- [ ] The configured cost policy prevents an intentional run above $5.

## Persistence

- [ ] Completed cases are persisted.
- [ ] A past case can be reopened.
- [ ] Its protocol and economics remain inspectable.

## Engineering

- [ ] API secrets never reach client-side code.
- [ ] Runtime prompts are version controlled.
- [ ] Application changes pass the project's future verification gate before entering the main line.
- [ ] The eventual deployed application can complete a real Tribunal run.
