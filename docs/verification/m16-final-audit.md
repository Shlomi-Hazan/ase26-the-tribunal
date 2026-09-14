# Milestone 16 — Final Verification Evidence Index

This document is the M16 final verification/evidence **index**. It points to the project's genuine historical audit trail rather than replacing it. It is not a retroactive log, and it did not exist during earlier development — it is a Milestone 16 artifact that gathers pointers to evidence that already existed.

The genuine historical audit trail is, and remains:

- Git commit and merge history
- `ROADMAP.md` milestone closeout records
- GitHub Issues
- GitHub Pull Requests
- GitHub Actions CI runs
- the tracked verification/ADR documents already in this repository (`docs/verification/`, `docs/adr/`)

Nothing below substitutes for reading those directly.

## 1. Audit scope

Milestone 16 audited the repository and deployed product as of `main` @ `193e89ab77e46cc04a1b90e616f579764b80ef14` (the Milestone 15 merge commit), covering intent/specification/architecture fidelity, milestone-by-milestone forensic reconstruction, Git/GitHub audit-trail integrity, security and dependency posture, and production evidence, before making any correction.

## 2. Core source-of-truth documents

| Document | Role |
|---|---|
| [Intent](../../INTENT.md) | Product purpose and durable direction |
| [Specification](../../SPEC.md) | Required, testable behavior |
| [Architecture](../../ARCHITECTURE.md) | Approved technical structure |
| [Agent Contract](../../AGENTS.md) | Standing rules for coding agents |
| [Claude Code Guidance](../../CLAUDE.md) | Claude-specific entry point |
| [Roadmap](../../ROADMAP.md) | Milestone sequencing and closeout records |
| [Security](../../SECURITY.md) | Threat model and security checklist |
| [Economics](../economics.md) | Cost/token/pricing formulas and policy |
| [UI Specification](../ui-spec.md) | Interaction and presentation contract |
| [Architecture Decision Records](../adr/) | Detailed per-milestone planning decisions |

## 3. Course workflow / source hierarchy

`CLAUDE.md`'s documented precedence — Intent → Specification → Architecture → focused docs → Roadmap → code — was followed in the observable commit history: every milestone shows a distinct planning artifact (an ADR or a `docs:`-prefixed planning PR) preceding its implementation PR. `INTENT.md` §19 records the intended Intent → Specification → Context → Plan → Execution → Verification → Audit-Trail loop this repository was built to demonstrate.

## 4. Milestone evidence index

| Milestone | Issue | PR(s) | Merge commit |
|---|---|---|---|
| M1 Conception | — | [#1](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/1) | `4ba05fb` |
| M2 Engineering Contract | — | [#2](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/2) | `0a95e34` |
| M3 Application Skeleton | [#3](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/3) | [#4](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/4) | `ac68a3d` |
| M4 UI Shell | [#5](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/5) | [#6](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/6) | `a2704d1` |
| M5 Case Persistence & Import | [#7](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/7) | [#8](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/8) | `fece1e1` |
| M6 Participant Configuration | [#9](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/9) | [#10](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/10) | `e7ab964` |
| M7 OpenRouter Infrastructure | [#11](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/11) | [#12](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/12) | `926ba66` |
| M7A Smart Extraction (plan + implementation) | [#13](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/13), [#15](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/15) | [#14](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/14), [#16](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/16) | `786872a`, `d5e9e78` |
| M8 Shared-Model Tribunal | [#17](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/17) | [#18](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/18) | `2159646` |
| M9 Separate-Model Tribunal | [#20](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/20) | [#21](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/21), [#22](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/22) | `ce7a103`, `f89e031` |
| M10 Protocol & Economics | [#23](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/23) | [#25](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/25) | `fc641f2` |
| M11 Past Cases & Auditability | [#27](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/27) | [#29](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/29) | `85aec6b` |
| PRO/CON semantic correction | [#30](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/30) | [#31](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/31) | `b881c5b` |
| M12 Canonical Jon Snow Demo | [#32](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/32) | [#33](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/33), [#34](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/34) | `a30dc4a`, `e3b9704` |
| M13 Failure & Security Hardening | [#36](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/36) | [#37](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/37) | `ce30cec` |
| M14 UI Polish & Accessibility | [#39](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/39) | [#40](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/40) | `b0afd02` |
| M15 Production Deployment | [#41](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/41) | [#42](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/42) | `193e89a` |
| M16 Final Verification & Course Audit | [#43](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/43) | (pending — this branch) | (pending) |

Full detail for every row above lives in `ROADMAP.md`'s own per-milestone section and, where one exists, its `### Closeout` subsection.

## 5. Important documented evolution

- **Agent Mode**: considered, then cancelled at M12 (`ROADMAP.md` M12; Issue #32; `SPEC.md` §7.3; `ARCHITECTURE.md` §17 — the last of which records that a considered execution-strategy seam was never built).
- **PRO/CON semantics**: corrected at Issue #30/PR #31; the historically reversed `advocate-v1` meaning is preserved unmodified, never reinterpreted (`SPEC.md` §2.2).
- **Jon Snow demo funding model**: BYOK-gated in Issue #32's original design, superseded by an explicit human product override in PR #34 to operator-funded, under a strictly lower cost ceiling (`SECURITY.md` §3.1.1, `docs/economics.md` §22.1).
- **Production dynamic-routing defect**: found live during M15 Phase B, root-caused against Netlify's own redirect documentation, fixed and hardened across two commits with an independent-review correction (`netlify/server/routing.ts`).

## 6. Production evidence

Production URL: `https://ase26-the-tribunal.netlify.app`.

One human-authorized, human-operated live Tribunal run is recorded in `ROADMAP.md`'s M15 closeout: case `d9b4a0a3-f0bc-4e18-82f9-7a2fda40c091`, run `ee671c6a-3002-420f-81e7-d457370718e9` — status `COMPLETED`, SHARED mode, `openai/gpt-4o-mini`, 7 logical calls / 7 provider attempts / 0 retries, deterministic majority GUILTY (2-1), actual cost `$0.004225815`. A second, earlier real Tribunal run is recorded in the M14 closeout above (PR #40), predating production deployment — status `COMPLETED`, 7 logical calls / 7 provider attempts / 0 retries, actual cost `$0.004006035`.

## 7. Security/economics evidence

See `SECURITY.md` §17.1–17.2 for the full dependency-audit history (M13's first recorded audit, M16's re-audit and partial remediation) and `docs/economics.md` for the complete pricing/budget formula set, including the two self-corrections recorded in `docs/adr/0003-openrouter-infrastructure.md` (decimal-arithmetic precision, cache-write pricing).

## 8. Historical CI flake and its correction

Four post-merge, push-triggered CI runs on `main` between 2026-08-31 and 2026-09-03 failed on a flaky subset of `src/features/case-setup/caseSetup.test.tsx` under parallel test workers. Every affected pull request's own pre-merge CI check was green at merge time — the flake only ever affected the redundant post-merge push trigger, never the actual merge gate. Root-caused and fixed at Milestone 13 (`vite.config.ts` `maxWorkers: 2`, PR #37). Zero recurrence in any push-triggered CI run on `main` since.

## 9. Final verification status (as of this Milestone 16 correction pass)

```
npm ci && npm run verify   → PASS
Test Files                 → 74 passed (74)
Tests                      → 1111 passed (1111)
lint / typecheck / build   → clean
client-bundle secret scan  → passed
Functions packaging check  → passed
npm audit                  → 6 vulnerabilities (1 moderate, 5 high), dev-only chain
npm audit --omit=dev       → 0 vulnerabilities
```

## 10. Known limitations

- A catastrophic (process-crash) Background Function failure between claiming a run and its terminal write has no automatic reconciliation (`ARCHITECTURE.md` §7.4, documented as an accepted, out-of-scope-for-M8 limitation, narrowed at M13 to exclude ordinary thrown exceptions).
- The residual dependency-security chain (`@netlify/dev`/`@netlify/images`/`ipx`/`sharp`, dev-only, zero deployed-runtime exposure) has no accepted safe forward fix as of this pass (`SECURITY.md` §17.2).
- V1 has no accounts/authentication and no private per-user data ownership, by design (`SPEC.md` §18, `SECURITY.md` §15).

## 11. Remaining M16 gates

The following are **not yet complete** as of this document's creation:

- **Human final production UI acceptance** — pending.
- **Final hostile/independent audit** — pending.
- **PR / CI / human merge gate** — pending; no pull request has been opened for this branch yet.

Milestone 16 is not complete until all three gates above have passed.
