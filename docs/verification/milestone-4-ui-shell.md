# Milestone 4 Verification Evidence: UI Shell with Mock Data

## Milestone

Milestone 4 - UI Shell with Mock Data.

## Planning Evidence

- GitHub issue: #5
- Issue URL: https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/5

## Branch and Base

- Branch: `milestone/04-ui-shell-mock-data`
- Base main SHA: `ac68a3d0c704ba39978f7a677e1a6887e8875395`
- Implementation commit SHA: `19592172d85c8bacd55e76dda5bd991d75ce61df`
- Review-driven follow-up commit SHA: `855c9f61af6608caf8734bd9fa16c7712eed6c48`

## Review-Driven Corrections

- Participant personality validation now uses one central 4,000-character rule.
- Advocate and judge progression is blocked when required personalities are empty or over limit.
- Setup step completion labels now reflect actual in-memory data validity instead of route position.
- Review now blocks mock convening when the Charge Sheet or participant configuration is invalid.
- Populated mock history no longer renders the empty state.
- Historical GUILTY and NOT_GUILTY result fixtures now match their Past Cases verdicts.
- Result heading semantics now preserve one primary level-1 heading on the result page.
- Detailed economics attempts are contained in a responsive horizontal-scroll table region.
- Screenshot evidence filenames were corrected from `.png` to `.jpg` because the stored bytes are JPEG.

## Screen and Route Inventory

- `/` redirects to `/new/charge-sheet`
- `/new/charge-sheet`
- `/new/advocates`
- `/new/judges`
- `/new/review`
- `/demo/deliberation`
- `/demo/result`
- `/history`
- unknown route fallback

## Mock Scenario Inventory

- advocates running: `/demo/deliberation?scenario=running`
- advocate retrying: `/demo/deliberation?scenario=retry`
- judge phase: `/demo/deliberation?scenario=judge`
- advocate terminal failure: `/demo/deliberation?scenario=advocate-failure`
- judge terminal failure: `/demo/deliberation?scenario=judge-failure`
- budget blocked: `/demo/deliberation?scenario=budget-blocked`
- completed transition: `/demo/deliberation?scenario=completed`
- completed and failed static history fixtures: `/history`

## Key Reusable Components

- `AppShell`
- `SetupStepper`
- `ExecutionModeControl`
- `ParticipantCard`
- `ModelSelect`
- `StatusBadge`
- `JudgeVoteGroup`
- `EconomicsSummary`
- `EmptyHistoryState`

## Tests

- Test files: 7 passed
- Tests: 28 passed

Coverage includes:

- primary navigation
- New Case route
- Past Cases route
- unknown route
- Charge Sheet required validation and successful next step
- Charge Sheet invalid continuation focuses the first invalid field
- participant personality empty and over-limit validation
- invalid advocate and judge progression guards
- data-driven setup completion labels
- invalid Review convening block
- exactly four fixed advocates
- exactly three fixed judges
- Shared Model single selector
- Separate Models participant selectors
- Review 7-call geometry, `$5.00` policy, privacy warning, and mock economics
- deliberation running/retry/judge/failure/budget-blocked states
- result hierarchy, heading semantics, and deterministic-majority explanation
- historical GUILTY and NOT_GUILTY fixture consistency
- populated history without contradictory empty state
- failed history item with no verdict
- empty history state
- responsive economics table containment
- automated keyboard traversal through primary navigation

## Verification Commands

- `npm run lint` - PASS
- `npm run typecheck` - PASS
- `npm run test` - PASS
- `npm run build` - PASS
- `npm run verify:client-bundle` - PASS
- `npm run verify` - PASS
- `npm audit --omit=dev --audit-level=high` - registry endpoint returned `ECONNRESET` during this session
- `npm audit --omit=dev --audit-level=high --offline` - PASS, `found 0 vulnerabilities`
- `git diff --check origin/main...HEAD` - PASS

Note: Vite emitted a non-failing bundle-size advisory during build. The build exited successfully and the verification gate passed.

## Manual UI Review

- Desktop layout: PASS via browser at 1366x900.
- Mobile layout: PASS via browser at 390x844.
- No obvious horizontal overflow: PASS on desktop Advocates, mobile Charge Sheet, and mobile Result.
- Primary navigation: PASS.
- Charge Sheet: PASS.
- Advocate 2x2 desktop grouping: PASS; all four advocate cards were visible at desktop width.
- Judge grouped desktop layout: PASS; all three judge cards were visible at desktop width.
- Shared mode: PASS; one shared mock model selector was visible.
- Separate mode: PASS; participant-level advocate selectors were visible after switching modes.
- Review: PASS; mock preflight, 7-call geometry, `$5.00` policy, and privacy warning were visible.
- Retry scenario: PASS; `Retrying` status was visible.
- Failure scenario: PASS; advocate and judge failure routes were explicit and did not render a verdict banner.
- Budget blocked: PASS; budget route was distinct from deliberation failure and rendered no failed participant status in the DOM snapshot.
- Completed result: PASS; majority appeared before judge votes, reasoning, speeches, and economics.
- Past Cases: PASS; completed and failed mock cases were visible, and failed case showed no verdict.
- Automated keyboard traversal: PASS via Testing Library/user-event primary navigation coverage.
- Manual keyboard traversal: NOT VERIFIED; the browser adapter did not produce a reliable active-control signal for Tab traversal.
- Manual visible-focus verification: NOT VERIFIED; the browser adapter did not produce a reliable focus-state signal.
- Field labels: PASS; Charge Sheet fields were accessible by label in browser automation.
- Status text independent of color: PASS; statuses are rendered as text labels.

## Screenshot Evidence

- `docs/verification/assets/milestone-4/desktop-review.jpg`
- `docs/verification/assets/milestone-4/desktop-deliberation-retry.jpg`
- `docs/verification/assets/milestone-4/desktop-result.jpg`
- `docs/verification/assets/milestone-4/mobile-charge-sheet.jpg`
- `docs/verification/assets/milestone-4/mobile-result.jpg`

`file docs/verification/assets/milestone-4/*` reported JPEG image data for all five screenshot files.

## Security and Scope Confirmation

- No OpenRouter call occurred.
- No OpenRouter implementation was added.
- No product Supabase query occurred.
- No migration was created.
- No persistence was implemented.
- No real file parser was implemented.
- No real model catalog or live pricing was implemented.
- No deployment was performed.
- No new dependency was added.

## Known Limitations

- All product data is mock or in-memory only.
- Setup state is not persisted across refresh.
- File import controls are visual/disabled until Milestone 5.
- Deliberation states are deterministic fixtures, not real execution.
- Economics are fixture data, not real calculation or live provider pricing.
- Manual keyboard traversal and visible focus still need independent verification before merge.
