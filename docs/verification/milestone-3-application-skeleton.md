# Milestone 3 Verification Evidence: Application Skeleton

## Milestone

Milestone 3 - Application Skeleton.

## Planning Evidence

- GitHub issue: #3
- Issue URL: https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/3

## Branch and Base

- Branch: `milestone/03-application-skeleton`
- Base main SHA: `0a95e3470cdad2e70030d738c33f3136e8ceffc2`
- Implementation commit SHA: `ddf24a272d95904ef06a96682aba78b637826f58`

## Major Areas Added

- npm package and lockfile foundation
- React, TypeScript, Vite, Material UI, and React Router shell
- Netlify Functions configuration and harmless health endpoint
- server-only Supabase configuration and client factory foundation
- environment-variable contract in `.env.example`
- ESLint, TypeScript, Vitest, React Testing Library, build, and verification scripts
- client bundle secret-boundary check
- GitHub Actions CI
- pull request template
- README, CLAUDE command guidance, and Roadmap status updates

## Dependency and Tooling Categories

- Runtime: React, React DOM, React Router, Material UI, Emotion, Zod, Supabase JS, Netlify Functions.
- Development: TypeScript, Vite, React Vite plugin, React/Node types, ESLint, TypeScript ESLint, React Hooks linting, React Refresh linting, Vitest, jsdom, React Testing Library, jest-dom, user-event, Netlify CLI.
- Dependency-resolution support: OpenTelemetry API peer used by the current approved tooling graph.

## Dependency Security Review

- Node runtime: `24.x`, as pinned by `.nvmrc`, `package.json` engines, and CI.
- Node type definitions: direct `@types/node` dependency aligned from `^26.3.0` to `^24.13.3`; resolved version is `24.13.3`.
- Production audit: `npm audit --omit=dev` and `npm audit --omit=dev --audit-level=high` both reported `found 0 vulnerabilities`.
- Full audit summary: 7 high-severity findings remain in development tooling.
- Runtime classification: remaining high-severity findings are not in the production/runtime dependency graph.
- Remaining chain: `netlify-cli` -> `@netlify/dev` -> `@netlify/functions-dev` -> `extract-zip`.
- Advisory: `GHSA-jmr9-qjv8-65gv` for `extract-zip` symlink path traversal.
- Remaining chain: `netlify-cli` -> `@netlify/dev` -> `@netlify/images` -> `ipx` -> `sharp`.
- Advisory: `GHSA-f88m-g3jw-g9cj` for `sharp` inherited libvips vulnerabilities, including `CVE-2026-33327`, `CVE-2026-33328`, `CVE-2026-35590`, and `CVE-2026-35591`.
- Upstream fix status: npm reports remediation only through `npm audit fix --force`, which would install `netlify-cli@23.15.1` and is a breaking downgrade from the current `netlify-cli@27.3.0` line.
- Decision: no force-fix was used.
- Milestone risk acceptance: Netlify CLI is development/build tooling, not browser or runtime application code, and this Milestone 3 skeleton does not process untrusted image uploads.
- OpenTelemetry check: `npm explain @opentelemetry/api` shows the direct root dev dependency satisfies Vitest's optional peer and participates in the current Netlify tooling graph; it was left unchanged.

## Verification Commands

- `npm run lint` - PASS
- `npm run typecheck` - PASS
- `npm run test` - PASS
- `npm run build` - PASS
- `npm run verify:client-bundle` - PASS
- `npm run verify` - PASS
- `git diff --check` - PASS

## Test Evidence

- Test files: 3 passed
- Tests: 7 passed

Covered foundation checks:

- root application rendering
- not-found route rendering
- health function success response
- health function unsupported-method response
- health response avoids credential material
- Supabase server client construction from injected test config
- missing/invalid Supabase server config rejection
- Supabase test fixtures use placeholder values only

## Security and External Calls

- No OpenRouter call occurred.
- No OpenRouter implementation exists in this milestone.
- No real Supabase query occurred.
- Supabase client construction was tested from injected placeholder config without a network request.
- No real secrets were created or committed.
- Privileged server-only identifiers are checked against the built browser bundle.

## Known Limitations

- No Tribunal behaviour exists yet.
- No Charge Sheet workflow exists yet.
- No participant configuration exists yet.
- No product database schema exists yet.
- No migrations exist yet.
- No real model calls exist yet.
- No deployment was performed.

## Working Tree at Evidence Time

Clean after the implementation commit and before this evidence document was added.
