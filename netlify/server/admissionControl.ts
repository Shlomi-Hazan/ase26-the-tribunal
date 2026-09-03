// Milestone 13 (Issue #36 G3) -- reuses the EXISTING, authoritative,
// cross-process-safe admission-control RPC (`check_and_record_admission`,
// supabase/migrations/20260828180000_setup_extractions.sql) that Milestone
// 7A's extraction endpoints already call via
// SupabaseExtractionRepository#checkAndRecordAdmission
// (netlify/server/extraction/repository.ts) -- extracted here into a
// small, domain-generic module so `/api/runs` and the operator-funded
// Jon Snow demo endpoint can call the SAME RPC under their own bucket
// namespaces ("run-start" / "jon-snow-demo-start") without depending on
// the extraction-specific repository type. NOT a new mechanism, NOT a
// second implementation, NOT a new table/RPC -- the RPC itself is
// bucket-generic by original design (any `text` bucket, Decision 19), so
// this module is a thin, typed wrapper only. No migration.
//
// The extraction module's own repository/fake keep their existing,
// separately-tested implementations untouched (independent-review-tested
// M7A surface, out of this correction's scope to refactor) -- this is a
// deliberate, small duplication of a ~15-line sliding-window+dedup
// algorithm rather than a risk-bearing refactor of that stable, heavily
// tested code, per this correction's own "no over-engineering" guidance.

import type { SupabaseClient } from "@supabase/supabase-js";

export class AdmissionControlPersistenceError extends Error {
  constructor(message = "Admission-control persistence failed.") {
    super(message);
    this.name = "AdmissionControlPersistenceError";
  }
}

export type AdmissionControl = {
  // Atomically checks whether `bucket` has capacity remaining under a
  // sliding `windowSeconds`-wide window bounded at `maxRequests`, and if
  // so, records this admission and returns true; otherwise false.
  // `requestId`, when non-null, makes the SAME logical request (e.g. an
  // idempotent client retry carrying the same clientRequestId) never
  // consume a second slot -- mirrors the RPC's own
  // (bucket, extraction_request_id) dedup exactly (Decision 19 Section
  // 3).
  checkAndRecordAdmission(
    bucket: string,
    requestId: string | null,
    windowSeconds: number,
    maxRequests: number
  ): Promise<boolean>;
};

export function createSupabaseAdmissionControl(client: SupabaseClient): AdmissionControl {
  return {
    async checkAndRecordAdmission(bucket, requestId, windowSeconds, maxRequests) {
      const { data, error } = await client.rpc("check_and_record_admission", {
        p_bucket: bucket,
        p_extraction_request_id: requestId,
        p_window_seconds: windowSeconds,
        p_max_requests: maxRequests
      });

      if (error) {
        throw new AdmissionControlPersistenceError();
      }

      return Boolean(data);
    }
  };
}

// Deterministic in-memory fake for tests -- mirrors the real RPC's
// sliding-window + same-(bucket,requestId) dedup semantics synchronously,
// no real database. A test injects this instead of
// createSupabaseAdmissionControl's real implementation.
export class FakeAdmissionControl implements AdmissionControl {
  private readonly events = new Map<string, Array<{ timestamp: number; requestId: string | null }>>();

  constructor(private readonly clock: () => number = Date.now) {}

  async checkAndRecordAdmission(
    bucket: string,
    requestId: string | null,
    windowSeconds: number,
    maxRequests: number
  ): Promise<boolean> {
    const now = this.clock();
    const windowStart = now - windowSeconds * 1000;
    // Corrected (independent review, PR #37): the real
    // check_and_record_admission RPC prunes with
    // `created_at < now() - window` -- i.e. an event whose timestamp is
    // EXACTLY at the boundary (`timestamp === windowStart`) is NOT
    // pruned, since it does not satisfy the strict `<`. `>= windowStart`
    // (not `> windowStart`) is therefore the exact match: the previous
    // strict `>` incorrectly evicted an exact-boundary event the real
    // SQL would still count.
    const existing = (this.events.get(bucket) ?? []).filter((event) => event.timestamp >= windowStart);

    if (requestId !== null && existing.some((event) => event.requestId === requestId)) {
      this.events.set(bucket, existing);

      return true;
    }

    if (existing.length >= maxRequests) {
      this.events.set(bucket, existing);

      return false;
    }

    existing.push({ timestamp: now, requestId });
    this.events.set(bucket, existing);

    return true;
  }
}
