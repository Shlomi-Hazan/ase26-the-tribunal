// Milestone 7 -- adapts the existing Supabase-backed RunRepository/
// CaseRepository (netlify/server/runs.ts, netlify/server/cases.ts) to the
// narrow PreflightRunLoader interface preflight.ts actually needs. No new
// database access path is introduced -- this reuses the same read-only
// SELECT-only repositories Milestone 6 already established.

import type { CaseRepository } from "../cases";
import type { RunRepository } from "../runs";
import type {
  PreflightCase,
  PreflightRun,
  PreflightRunLoader
} from "./preflight";
import type { ParticipantId } from "../../../src/schemas/tribunalSetup";

export function createPreflightRunLoader(
  runRepository: RunRepository,
  caseRepository: CaseRepository
): PreflightRunLoader {
  return {
    async getRun(runId: string): Promise<PreflightRun | null> {
      const run = await runRepository.getById(runId);

      if (!run) {
        return null;
      }

      return {
        id: run.id,
        caseId: run.caseId,
        participants: run.participants.map((participant) => ({
          participantId: participant.participantId as ParticipantId,
          modelId: participant.modelId,
          personality: participant.personality,
          promptVersion: participant.promptVersion
        }))
      };
    },

    async getCase(caseId: string): Promise<PreflightCase | null> {
      const persistedCase = await caseRepository.getById(caseId);

      if (!persistedCase) {
        return null;
      }

      return {
        defendant: persistedCase.defendant,
        act: persistedCase.act,
        exactQuestion: persistedCase.exactQuestion
      };
    }
  };
}
