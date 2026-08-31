import { describe, expect, it } from "vitest";
import { participantIds, type ParticipantId } from "../../src/schemas/tribunalSetup";
import { ADVOCATE_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "../../src/prompts/versions";
import {
  buildAdmissionReserveEvidence,
  buildAttemptAudits,
  computePartialSpend,
  computeRequestFingerprint,
  computeWallClockMs,
  PROMPT_VERSION_PLACEHOLDER,
  RunValidationError,
  sortParticipantsCanonically,
  validateCreateRunInput,
  validateRunId,
  type AttemptRow,
  type CaseFingerprintInput,
  type ParticipantFingerprintInput,
  type PersistedParticipantConfig
} from "./runs";

function persistedParticipant(id: ParticipantId): PersistedParticipantConfig {
  const isAdvocate = id.startsWith("advocate-");

  return {
    id: `00000000-0000-4000-8000-${id.length.toString().padStart(12, "0")}`,
    participantId: id,
    role: isAdvocate ? "ADVOCATE" : "JUDGE",
    side: id.includes("-pro-") ? "PRO" : id.includes("-con-") ? "CON" : null,
    profileName: null,
    personality: `Personality for ${id}.`,
    personalitySource: "manual",
    personalitySourceFilename: null,
    modelId: "mock/free-deliberator",
    promptVersion: "unassigned-pre-m7",
    attemptStatus: "PENDING",
    speech: null,
    verdict: null,
    reasoning: null
  };
}

function participant(
  id: ParticipantId,
  overrides: Partial<ParticipantFingerprintInput> = {}
): ParticipantFingerprintInput {
  return {
    participantId: id,
    profileName: "",
    personality: `Personality for ${id}.`,
    personalitySource: "manual",
    personalitySourceFilename: "",
    modelId: "mock/free-deliberator",
    ...overrides
  };
}

function sevenParticipants(
  overrides: Partial<Record<ParticipantId, Partial<ParticipantFingerprintInput>>> = {}
): ParticipantFingerprintInput[] {
  return participantIds.map((id) => participant(id, overrides[id]));
}

const existingCase: CaseFingerprintInput = {
  kind: "existing",
  caseId: "11111111-1111-4111-8111-111111111111"
};

function baseFingerprintInput(
  overrides: Partial<{
    caseInput: CaseFingerprintInput;
    executionMode: "SHARED" | "SEPARATE";
    participants: ParticipantFingerprintInput[];
    promptVersions: { advocate: string; judge: string };
  }> = {}
) {
  return {
    caseInput: existingCase,
    executionMode: "SHARED" as const,
    participants: sevenParticipants(),
    // Correction (independent review, pre-live gate): the current
    // application-owned role-specific versions -- never the old M6
    // placeholder -- matching what acceptRun now actually supplies.
    promptVersions: {
      advocate: ADVOCATE_PROMPT_VERSION,
      judge: JUDGE_PROMPT_VERSION
    },
    ...overrides
  };
}

function validPackageParticipants() {
  return participantIds.map((id) =>
    participant(id, {
      personalitySource: "tribunal_package",
      personalitySourceFilename: "package.md"
    })
  );
}

function validCreateRunInput(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    clientRequestId: "22222222-2222-4222-8222-222222222222",
    case: { kind: "existing", caseId: "11111111-1111-4111-8111-111111111111" },
    executionMode: "shared",
    participants: participantIds.map((id) => ({
      participantId: id,
      personality: `Personality for ${id}.`,
      personalitySource: "manual",
      modelId: "mock/free-deliberator"
    })),
    ...overrides
  };
}

describe("computeRequestFingerprint", () => {
  it("is deterministic for identical semantic input", () => {
    const first = computeRequestFingerprint(baseFingerprintInput());
    const second = computeRequestFingerprint(baseFingerprintInput());

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the case identity changes", () => {
    const first = computeRequestFingerprint(baseFingerprintInput());
    const second = computeRequestFingerprint(
      baseFingerprintInput({
        caseInput: {
          kind: "existing",
          caseId: "33333333-3333-4333-8333-333333333333"
        }
      })
    );

    expect(first).not.toBe(second);
  });

  it("distinguishes an existing case from an equivalent-looking new case", () => {
    const asExisting = computeRequestFingerprint(baseFingerprintInput());
    const asNew = computeRequestFingerprint(
      baseFingerprintInput({
        caseInput: {
          kind: "new",
          defendant: "Alex Rowan",
          act: "Some act.",
          exactQuestion: "A question?",
          sourceType: "MANUAL",
          sourceFilename: null
        }
      })
    );

    expect(asExisting).not.toBe(asNew);
  });

  it("changes when one participant's personality changes", () => {
    const first = computeRequestFingerprint(baseFingerprintInput());
    const second = computeRequestFingerprint(
      baseFingerprintInput({
        participants: sevenParticipants({
          "advocate-pro-1": { personality: "A materially different personality." }
        })
      })
    );

    expect(first).not.toBe(second);
  });

  it("changes when one participant's model changes", () => {
    const first = computeRequestFingerprint(baseFingerprintInput());
    const second = computeRequestFingerprint(
      baseFingerprintInput({
        participants: sevenParticipants({
          "judge-3": { modelId: "mock/deep-review" }
        })
      })
    );

    expect(first).not.toBe(second);
  });

  it("changes when execution mode changes", () => {
    const first = computeRequestFingerprint(baseFingerprintInput());
    const second = computeRequestFingerprint(
      baseFingerprintInput({ executionMode: "SEPARATE" })
    );

    expect(first).not.toBe(second);
  });

  it("is independent of the order participants were supplied in", () => {
    const forward = sevenParticipants();
    const reversed = [...forward].reverse();

    const first = computeRequestFingerprint(baseFingerprintInput({ participants: forward }));
    const second = computeRequestFingerprint(
      baseFingerprintInput({ participants: reversed })
    );

    expect(first).toBe(second);
  });

  it("normalizes absent optional fields deterministically", () => {
    const withEmptyStrings = computeRequestFingerprint(
      baseFingerprintInput({
        participants: sevenParticipants({
          "judge-1": { profileName: "", personalitySourceFilename: "" }
        })
      })
    );
    const withEmptyStringsAgain = computeRequestFingerprint(
      baseFingerprintInput({
        participants: sevenParticipants({
          "judge-1": { profileName: "", personalitySourceFilename: "" }
        })
      })
    );

    expect(withEmptyStrings).toBe(withEmptyStringsAgain);

    const withProfileName = computeRequestFingerprint(
      baseFingerprintInput({
        participants: sevenParticipants({
          "judge-1": { profileName: "Named Judge", personalitySourceFilename: "" }
        })
      })
    );

    expect(withProfileName).not.toBe(withEmptyStrings);
  });

  // Idempotency regression tests (independent review, pre-live gate,
  // Section 14) -- prove the fingerprint now represents the current
  // role-specific prompt-version contract, not the retired M6 placeholder.

  it("A: same semantic request + same current advocate/judge versions -> same fingerprint", () => {
    const first = computeRequestFingerprint(baseFingerprintInput());
    const second = computeRequestFingerprint(baseFingerprintInput());

    expect(first).toBe(second);
  });

  it("B: advocate-v1 -> advocate-v2 changes the fingerprint (judge version held constant)", () => {
    const withV1 = computeRequestFingerprint(baseFingerprintInput());
    const withV2 = computeRequestFingerprint(
      baseFingerprintInput({
        promptVersions: { advocate: "advocate-v2", judge: JUDGE_PROMPT_VERSION }
      })
    );

    expect(withV1).not.toBe(withV2);
  });

  it("C: judge-v1 -> judge-v2 changes the fingerprint (advocate version held constant)", () => {
    const withV1 = computeRequestFingerprint(baseFingerprintInput());
    const withV2 = computeRequestFingerprint(
      baseFingerprintInput({
        promptVersions: { advocate: ADVOCATE_PROMPT_VERSION, judge: "judge-v2" }
      })
    );

    expect(withV1).not.toBe(withV2);
  });

  it("distinguishes the current role-specific versions from the retired M6 placeholder", () => {
    const currentVersions = computeRequestFingerprint(baseFingerprintInput());
    const placeholderVersions = computeRequestFingerprint(
      baseFingerprintInput({
        promptVersions: {
          advocate: PROMPT_VERSION_PLACEHOLDER,
          judge: PROMPT_VERSION_PLACEHOLDER
        }
      })
    );

    expect(currentVersions).not.toBe(placeholderVersions);
  });
});

describe("validateCreateRunInput", () => {
  it("accepts a valid Shared-Model request with exactly seven participants", () => {
    const result = validateCreateRunInput(validCreateRunInput());

    expect(result.participants).toHaveLength(7);
  });

  it("accepts a valid Separate-Model request with distinct model IDs", () => {
    const result = validateCreateRunInput(
      validCreateRunInput({
        executionMode: "separate",
        participants: participantIds.map((id, index) => ({
          participantId: id,
          personality: `Personality for ${id}.`,
          personalitySource: "manual",
          modelId: `mock/model-${index}`
        }))
      })
    );

    expect(new Set(result.participants.map((entry) => entry.modelId)).size).toBe(7);
  });

  it("rejects a missing participant", () => {
    const input = validCreateRunInput();
    const participants = (input.participants as unknown[]).slice(0, 6);

    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );
  });

  it("rejects a duplicate participant key", () => {
    const input = validCreateRunInput();
    const participants = (input.participants as Array<{ participantId: string }>).slice(
      0,
      6
    );
    participants.push({ ...participants[0] });

    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );
  });

  it("rejects an unknown eighth participant key", () => {
    const input = validCreateRunInput();
    const participants = [
      ...(input.participants as Array<Record<string, unknown>>),
      {
        participantId: "advocate-pro-1",
        personality: "Extra.",
        personalitySource: "manual",
        modelId: "mock/free-deliberator"
      }
    ];

    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );
  });

  it("rejects a caller-supplied role/side/promptVersion field", () => {
    const input = validCreateRunInput();
    const participants = input.participants as Array<Record<string, unknown>>;
    participants[0] = { ...participants[0], role: "JUDGE" };

    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );

    participants[0] = { ...participants[0], side: "CON" };
    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );

    participants[0] = { ...participants[0], promptVersion: "v2" };
    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );
  });

  // Section 14E: caller cannot supply/override prompt versions -- neither
  // the retired singular field name (already covered above) nor the
  // current plural, role-specific shape acceptRun now computes
  // internally.
  it("rejects a caller-supplied promptVersions field", () => {
    const input = validCreateRunInput();
    const participants = input.participants as Array<Record<string, unknown>>;
    participants[0] = {
      ...participants[0],
      promptVersions: { advocate: "advocate-v2", judge: "judge-v2" }
    };

    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );
  });

  it("enforces profileName and personality bounds", () => {
    const input = validCreateRunInput();
    const participants = input.participants as Array<Record<string, unknown>>;

    participants[0] = { ...participants[0], profileName: "x".repeat(121) };
    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );

    participants[0] = { ...participants[0], profileName: "Valid Name", personality: "" };
    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );

    participants[0] = { ...participants[0], personality: "x".repeat(4001) };
    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );
  });

  it("enforces personality source/filename cross-field consistency", () => {
    const input = validCreateRunInput();
    const participants = input.participants as Array<Record<string, unknown>>;

    // individual_file without a filename is rejected.
    participants[0] = {
      ...participants[0],
      personalitySource: "individual_file"
    };
    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );

    // manual with a filename present is rejected (extra key on that branch).
    participants[0] = {
      ...participants[0],
      personalitySource: "manual",
      personalitySourceFilename: "sneaky.md"
    };
    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );

    // tribunal_package with an unsafe filename is rejected.
    participants[0] = {
      participantId: participants[0].participantId,
      personality: participants[0].personality,
      modelId: participants[0].modelId,
      personalitySource: "tribunal_package",
      personalitySourceFilename: "../escape.md"
    };
    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );

    // valid tribunal_package + safe filename is accepted.
    const validParticipants = validPackageParticipants().map((entry) => ({
      participantId: entry.participantId,
      personality: entry.personality,
      personalitySource: entry.personalitySource,
      personalitySourceFilename: entry.personalitySourceFilename,
      modelId: "mock/free-deliberator"
    }));
    expect(() =>
      validateCreateRunInput({ ...input, participants: validParticipants })
    ).not.toThrow();
  });

  it("accepts a 1-character and a 256-character model id", () => {
    // Separate mode, so a single participant's model id can vary
    // independently of the rest -- Shared mode's "all seven identical"
    // rule is exercised separately below.
    const input = validCreateRunInput({ executionMode: "separate" });
    const participants = input.participants as Array<Record<string, unknown>>;

    participants[0] = { ...participants[0], modelId: "x" };
    expect(() => validateCreateRunInput({ ...input, participants })).not.toThrow();

    participants[0] = { ...participants[0], modelId: "x".repeat(256) };
    expect(() => validateCreateRunInput({ ...input, participants })).not.toThrow();
  });

  it("rejects a 257-character model id", () => {
    const input = validCreateRunInput();
    const participants = input.participants as Array<Record<string, unknown>>;

    participants[0] = { ...participants[0], modelId: "x".repeat(257) };
    expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
      RunValidationError
    );
  });

  it("rejects control characters, newlines, and DEL in a model id", () => {
    const input = validCreateRunInput();
    const participants = input.participants as Array<Record<string, unknown>>;

    for (const badId of ["bad\nmodel", "bad\rmodel", `bad${String.fromCharCode(0x7f)}model`]) {
      participants[0] = { ...participants[0], modelId: badId };
      expect(() => validateCreateRunInput({ ...input, participants })).toThrow(
        RunValidationError
      );
    }
  });

  it("rejects mismatched model IDs in Shared-Model Mode", () => {
    const input = validCreateRunInput();
    const participants = input.participants as Array<Record<string, unknown>>;
    participants[0] = { ...participants[0], modelId: "mock/deep-review" };

    expect(() =>
      validateCreateRunInput({ ...input, executionMode: "shared", participants })
    ).toThrow(RunValidationError);
  });

  it("rejects a malformed case union (both branches, or neither)", () => {
    const input = validCreateRunInput();

    expect(() =>
      validateCreateRunInput({
        ...input,
        case: { kind: "existing", caseId: "11111111-1111-4111-8111-111111111111", case: {} }
      })
    ).toThrow(RunValidationError);

    expect(() =>
      validateCreateRunInput({ ...input, case: { kind: "unknown" } })
    ).toThrow(RunValidationError);
  });

  it("rejects an invalid existing caseId", () => {
    const input = validCreateRunInput({
      case: { kind: "existing", caseId: "not-a-uuid" }
    });

    expect(() => validateCreateRunInput(input)).toThrow(RunValidationError);
  });

  it("rejects extra structural fields on the top-level request", () => {
    const input = validCreateRunInput();

    expect(() =>
      validateCreateRunInput({ ...input, unexpectedField: true })
    ).toThrow(RunValidationError);
  });
});

describe("validateRunId", () => {
  it("accepts a valid UUID", () => {
    expect(validateRunId("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("rejects a malformed id", () => {
    expect(() => validateRunId("not-a-uuid")).toThrow(RunValidationError);
  });
});

describe("sortParticipantsCanonically", () => {
  it("normalizes a shuffled persisted participant array into canonical order", () => {
    // PostgreSQL does not promise participant_configs row order without an
    // explicit ORDER BY (none is applied) -- simulate an arbitrary
    // database-return order and confirm the public output is always the
    // fixed application order (participantIds), regardless of input order.
    const shuffled: PersistedParticipantConfig[] = [
      persistedParticipant("judge-2"),
      persistedParticipant("advocate-con-2"),
      persistedParticipant("judge-1"),
      persistedParticipant("advocate-pro-1"),
      persistedParticipant("judge-3"),
      persistedParticipant("advocate-con-1"),
      persistedParticipant("advocate-pro-2")
    ];

    const sorted = sortParticipantsCanonically(shuffled);

    expect(sorted.map((entry) => entry.participantId)).toEqual([
      "advocate-pro-1",
      "advocate-pro-2",
      "advocate-con-1",
      "advocate-con-2",
      "judge-1",
      "judge-2",
      "judge-3"
    ]);
  });

  it("does not mutate the input array", () => {
    const shuffled: PersistedParticipantConfig[] = [
      persistedParticipant("judge-1"),
      persistedParticipant("advocate-pro-1")
    ];
    const originalOrder = shuffled.map((entry) => entry.participantId);

    sortParticipantsCanonically(shuffled);

    expect(shuffled.map((entry) => entry.participantId)).toEqual(originalOrder);
  });

  it("is already-sorted-input stable (idempotent)", () => {
    const canonical = participantIds.map((id) => persistedParticipant(id));

    expect(sortParticipantsCanonically(canonical).map((entry) => entry.participantId)).toEqual(
      participantIds
    );
  });
});

// ---------------------------------------------------------------------
// Milestone 10 -- Attempt Audit / partial spend / admission-evidence
// pure functions (Issue #23). Deliberately tested directly, mirroring
// sortParticipantsCanonically's own established pattern above, rather
// than through a fake Supabase client -- this codebase has never mocked
// the Supabase query-builder chain; every repository's own read-time
// LOGIC is instead factored into plain, directly-testable functions.
// ---------------------------------------------------------------------

function attemptRow(participantConfigId: string, overrides: Partial<AttemptRow> = {}): AttemptRow {
  return {
    participant_config_id: participantConfigId,
    attempt_number: 1,
    status: "SUCCESS",
    configured_model_id: "openai/gpt-5-nano",
    canonical_model_id: "openai/gpt-5-nano-2025-08-07",
    provider_endpoint_tag: "azure/swedencentral",
    prompt_version: "advocate-v1",
    conservative_max_cost_usd: "0.00098076",
    provider_request_id: "gen-abc123",
    input_tokens: 409,
    output_tokens: 566,
    total_tokens: 975,
    input_price_per_million: "0.055",
    output_price_per_million: "0.44",
    request_price_usd: "0",
    actual_cost_usd: "0.000271535",
    derived_cost_usd: "0.000271535",
    pricing_observed_at: "2026-08-31T08:58:30.06+00:00",
    latency_ms: 5091,
    error_category: null,
    error_message: null,
    started_at: "2026-08-31T08:58:30.402823+00:00",
    completed_at: "2026-08-31T08:58:35.600479+00:00",
    ...overrides
  };
}

describe("buildAttemptAudits (Milestone 10, Issue #23 Finding 4)", () => {
  const proI = persistedParticipant("advocate-pro-1");
  const judge1 = persistedParticipant("judge-1");
  const participantById = new Map([
    [proI.id, proI],
    [judge1.id, judge1]
  ]);

  it("normalizes shuffled DB rows into canonical-participant-then-attempt-number order", () => {
    const shuffled: AttemptRow[] = [
      attemptRow(judge1.id, { attempt_number: 1 }),
      attemptRow(proI.id, { attempt_number: 2, status: "TIMEOUT" }),
      attemptRow(proI.id, { attempt_number: 1 })
    ];

    const audits = buildAttemptAudits(shuffled, participantById);

    expect(audits.map((entry) => `${entry.participantId}#${entry.attemptNumber}`)).toEqual([
      "advocate-pro-1#1",
      "advocate-pro-1#2",
      "judge-1#1"
    ]);
  });

  it("skips a row whose participant_config_id resolves to no known participant", () => {
    const audits = buildAttemptAudits([attemptRow("unknown-config-id")], participantById);

    expect(audits).toHaveLength(0);
  });

  it("carries every field through as a decimal-safe string or the raw null it persisted as", () => {
    const audits = buildAttemptAudits(
      [attemptRow(proI.id, { conservative_max_cost_usd: null, actual_cost_usd: null, derived_cost_usd: null })],
      participantById
    );

    expect(audits[0].conservativeMaxCostUsd).toBeNull();
    expect(audits[0].actualCostUsd).toBeNull();
    expect(audits[0].derivedCostUsd).toBeNull();
    expect(audits[0].configuredModelId).toBe("openai/gpt-5-nano");
    expect(audits[0].providerRequestId).toBe("gen-abc123");
  });

  it("never fabricates zero for missing token/cost telemetry", () => {
    const audits = buildAttemptAudits(
      [attemptRow(proI.id, { input_tokens: null, output_tokens: null, total_tokens: null })],
      participantById
    );

    expect(audits[0].inputTokens).toBeNull();
    expect(audits[0].outputTokens).toBeNull();
    expect(audits[0].totalTokens).toBeNull();
  });
});

describe("computePartialSpend (Milestone 10, Issue #23 Finding 2)", () => {
  it("returns null when zero attempt rows exist (BLOCKED_BUDGET / never-claimed) -- not a fabricated $0", () => {
    expect(computePartialSpend([])).toBeNull();
  });

  it("sums known effective costs (actual ?? derived) when every attempt's cost is known", () => {
    const result = computePartialSpend([
      attemptRow("a", { actual_cost_usd: "0.001", derived_cost_usd: "0.001" }),
      attemptRow("b", { actual_cost_usd: null, derived_cost_usd: "0.002" })
    ]);

    expect(result).toEqual({ knownCostUsd: "0.003", hasUnknownCost: false });
  });

  it("flags hasUnknownCost and still sums the known subset -- never discards known spend", () => {
    const result = computePartialSpend([
      attemptRow("a", { actual_cost_usd: "0.001", derived_cost_usd: null }),
      attemptRow("b", { actual_cost_usd: "0.002", derived_cost_usd: null }),
      attemptRow("c", { actual_cost_usd: null, derived_cost_usd: null })
    ]);

    expect(result).toEqual({ knownCostUsd: "0.003", hasUnknownCost: true });
  });

  it("prefers actual over derived when both are present", () => {
    const result = computePartialSpend([attemptRow("a", { actual_cost_usd: "0.005", derived_cost_usd: "0.009" })]);

    expect(result).toEqual({ knownCostUsd: "0.005", hasUnknownCost: false });
  });
});

describe("buildAdmissionReserveEvidence (Milestone 10, Issue #23 Sec 8)", () => {
  const proI = persistedParticipant("advocate-pro-1");
  const judge1 = persistedParticipant("judge-1");
  const participantById = new Map([
    [proI.id, proI],
    [judge1.id, judge1]
  ]);

  it("groups every attempt row's reserve by logical participant, preserving retries as separate entries", () => {
    const evidence = buildAdmissionReserveEvidence(
      [
        attemptRow(proI.id, { attempt_number: 1, conservative_max_cost_usd: "0.001" }),
        attemptRow(proI.id, { attempt_number: 2, conservative_max_cost_usd: "0.001" }),
        attemptRow(judge1.id, { attempt_number: 1, conservative_max_cost_usd: "0.0015" })
      ],
      participantById
    );

    const proEntry = evidence.find((entry) => entry.participantId === "advocate-pro-1");

    expect(proEntry?.conservativeMaxCostUsdByAttempt).toEqual(["0.001", "0.001"]);
    expect(evidence.find((entry) => entry.participantId === "judge-1")?.conservativeMaxCostUsdByAttempt).toEqual([
      "0.0015"
    ]);
  });

  it("skips attempt rows for an unresolvable participant_config_id", () => {
    const evidence = buildAdmissionReserveEvidence([attemptRow("unknown-config-id")], participantById);

    expect(evidence).toHaveLength(0);
  });
});

describe("computeWallClockMs (Milestone 10, Issue #23 Sec 6/9)", () => {
  it("computes duration from valid started/completed timestamps", () => {
    expect(
      computeWallClockMs("2026-08-31T08:58:30.000Z", "2026-08-31T08:58:42.500Z")
    ).toBe(12500);
  });

  it("returns null when either timestamp is missing", () => {
    expect(computeWallClockMs(null, "2026-08-31T08:58:42.500Z")).toBeNull();
    expect(computeWallClockMs("2026-08-31T08:58:30.000Z", null)).toBeNull();
    expect(computeWallClockMs(null, null)).toBeNull();
  });

  it("fails closed to null on an anomalous negative duration rather than showing a negative number", () => {
    expect(computeWallClockMs("2026-08-31T08:58:42.500Z", "2026-08-31T08:58:30.000Z")).toBeNull();
  });

  it("fails closed to null on an unparseable timestamp, never using browser/current time", () => {
    expect(computeWallClockMs("not-a-date", "2026-08-31T08:58:42.500Z")).toBeNull();
  });
});
