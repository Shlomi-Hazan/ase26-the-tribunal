import { describe, expect, it } from "vitest";
import { participantIds, type ParticipantId } from "../../src/schemas/tribunalSetup";
import {
  computeRequestFingerprint,
  PROMPT_VERSION_PLACEHOLDER,
  RunValidationError,
  sortParticipantsCanonically,
  validateCreateRunInput,
  validateRunId,
  type CaseFingerprintInput,
  type ParticipantFingerprintInput,
  type PersistedParticipantConfig
} from "./runs";

function persistedParticipant(id: ParticipantId): PersistedParticipantConfig {
  const isAdvocate = id.startsWith("advocate-");

  return {
    participantId: id,
    role: isAdvocate ? "ADVOCATE" : "JUDGE",
    side: id.includes("-pro-") ? "PRO" : id.includes("-con-") ? "CON" : null,
    profileName: null,
    personality: `Personality for ${id}.`,
    personalitySource: "manual",
    personalitySourceFilename: null,
    modelId: "mock/free-deliberator",
    promptVersion: "unassigned-pre-m7"
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
    promptVersion: string;
  }> = {}
) {
  return {
    caseInput: existingCase,
    executionMode: "SHARED" as const,
    participants: sevenParticipants(),
    promptVersion: PROMPT_VERSION_PLACEHOLDER,
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
