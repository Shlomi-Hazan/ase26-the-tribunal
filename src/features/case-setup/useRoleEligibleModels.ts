// M9 (Separate-Model Tribunal, Issue #20) -- one shared fetch of the
// real GET /api/models?role=... catalog per role, reused by every
// ParticipantCard of that role (4 advocate cards share one ADVOCATE
// fetch, 3 judge cards share one JUDGE fetch) -- never one independent
// fetch per card. Deliberately does NOT bake in an auto-select callback
// the way useEligibleModels does for the single Shared selector: each
// ParticipantCard owns its own participant's modelId and is responsible
// for its own repair/auto-select decision against this shared catalog
// (see ParticipantCard.tsx) -- a single catalog fetch can serve several
// independent per-seat decisions.

import { useEffect, useState } from "react";
import {
  fetchRoleEligibleModels,
  type ParticipantRole,
  type RoleEligibleModel
} from "../../services/modelsApi";

export function useRoleEligibleModels(role: ParticipantRole) {
  const [models, setModels] = useState<RoleEligibleModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const result = await fetchRoleEligibleModels(role);

        if (!cancelled) {
          setModels(result);
        }
      } catch {
        if (!cancelled) {
          setError(`The eligible ${role.toLowerCase()} model catalog could not be loaded.`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [role]);

  return { models, loading, error };
}
