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
