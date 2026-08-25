# ADR 0001 - Tribunal Package Import Strategy

## Status

Accepted

## Context

The Tribunal can be configured manually and through individual imports. A new approved requirement adds the ability to upload one complete Tribunal file that populates the full setup draft.

Course evaluation may provide a complete human-oriented dossier, but the product must remain generic. No specific lecturer dossier, fictional character set, judicial profile set, or case may become canonical product configuration.

## Decision

- Use a normalized `TribunalSetupDraft` as the shared internal target for manual entry, individual imports, strict package import, and future smart extraction.
- Implement Milestone 5 package import as a strict deterministic `.txt` / `.md` format.
- Implement future M7A free-form/PDF smart extraction only after the OpenRouter service boundary exists in Milestone 7.
- Make both deterministic package import and future smart extraction converge on the same Review screen.
- Require explicit human confirmation before convening the Tribunal.
- Keep participant seats application-owned.
- Do not hard-code a lecturer dossier.
- Do not allow import to automatically start Tribunal execution.

## Alternatives Rejected

1. Hard-code the lecturer dossier.
2. Use brittle regexes to interpret arbitrary human PDFs.
3. Implement LLM extraction before OpenRouter infrastructure.
4. Let upload automatically convene the Tribunal.

## Consequences

- The project has one normalized setup path across manual, deterministic import, and future smart extraction flows.
- Parser behaviour is easier to test because the Milestone 5 package format is strict.
- The execution boundary is safer because imports cannot trigger model spend.
- M7A remains real future work with separate cost, extraction, schema, and review requirements.
- Human review remains mandatory before any Tribunal run starts.
