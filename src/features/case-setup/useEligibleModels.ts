// Milestone 8 -- independent audit correction (Issue #17 blocker 1).
// One shared fetch of the real GET /api/models catalog (M7, zero-cost
// metadata), used by both ExecutionModeControl's Shared-Model selector
// and ReviewPage's read-only summary. Auto-selection lives HERE, not
// duplicated per call site -- a real bug this correction itself caught:
// an earlier revision put the auto-select effect only inside
// ExecutionModeControl, which is never rendered on ReviewPage, so a
// setup reached directly on /new/review (e.g. after a Smart Import
// apply) could never auto-select a real model and stayed permanently
// stuck on "Select a Shared model above."

import { useEffect, useState } from "react";
import { fetchEligibleModels, type EligibleModel } from "../../services/modelsApi";

export function useEligibleModels(currentModelId?: string, onAutoSelect?: (modelId: string) => void) {
  const [models, setModels] = useState<EligibleModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const result = await fetchEligibleModels();

        if (!cancelled) {
          setModels(result);
        }
      } catch {
        if (!cancelled) {
          setError("The eligible model catalog could not be loaded.");
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
  }, []);

  // Auto-select the first eligible real model once the catalog loads, if
  // nothing valid is currently selected -- never a mock model id, never
  // silently left unselected for a setup draft the user cannot fix from
  // this page. Callers that don't need this (a read-only display with no
  // way to change the selection) simply omit the callback.
  useEffect(() => {
    if (
      !loading &&
      !error &&
      onAutoSelect &&
      models.length > 0 &&
      !models.some((model) => model.id === currentModelId)
    ) {
      onAutoSelect(models[0].id);
    }
  }, [loading, error, models, currentModelId, onAutoSelect]);

  return { models, loading, error };
}
