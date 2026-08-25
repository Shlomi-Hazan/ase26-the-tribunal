# The Tribunal

Course project for **Agentic Software Engineering (ASE-26)**.

The Tribunal is a cognified web application in which AI advocates argue a case and AI judges deliberate and return reasoned verdicts. The current repository establishes the executable application skeleton and verification gate only; real Tribunal execution begins in later milestones.

## Status

Application skeleton.

## Stack

- React
- TypeScript
- Vite
- Material UI
- React Router
- Zod
- Netlify Functions
- Supabase server client foundation

## Prerequisites

- Node.js 24
- npm
- Netlify CLI through project dependencies

## Local Setup

```sh
npm install
cp .env.example .env
```

The `.env.example` file contains empty placeholders only. Never commit real secrets or API keys.

## Commands

```sh
npm run dev
npm run dev:netlify
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify:client-bundle
npm run verify
```

Use `npm run dev:netlify` to run the Vite frontend with Netlify Functions locally. The health endpoint is available at:

```text
/api/health
```

## Verification

Run the full mechanical gate:

```sh
npm run verify
```

## Project Documents

- [Intent](INTENT.md)
- [Specification](SPEC.md)
- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
