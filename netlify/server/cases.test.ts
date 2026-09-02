// Milestone 11 (Issue #27) -- independent-review correction: PostgreSQL's
// own ORDER BY (created_at DESC, id DESC) is the sole, authoritative
// ordering for SupabaseCaseRepository.list(). An in-memory JS re-sort
// keyed on Date.parse(createdAt) was removed -- it would have been lossy
// against timestamptz's microsecond resolution (JS Date is
// millisecond-precision) and could have incorrectly reordered two rows
// Postgres had already ordered correctly within the same millisecond.
//
// These are narrow, purpose-built recording-fake query-contract tests --
// not a general mock of the Supabase query builder's return-value
// semantics (this codebase deliberately avoids that elsewhere) -- used
// only to assert (a) the exact query shape/order requested from Postgres,
// and (b) that the repository never reorders what the query builder
// handed back.

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseCaseRepository } from "./cases";

type RecordedCall = { method: string; args: unknown[] };

class RecordingCaseQueryBuilder {
  readonly calls: RecordedCall[] = [];

  constructor(private readonly rows: unknown[]) {}

  from(table: string) {
    this.calls.push({ method: "from", args: [table] });
    return this;
  }

  select(columns: string) {
    this.calls.push({ method: "select", args: [columns] });
    return this;
  }

  order(column: string, options: unknown) {
    this.calls.push({ method: "order", args: [column, options] });
    return this;
  }

  // Minimal thenable so `await this.client.from(...)....` resolves
  // exactly like the real Supabase query builder, without emulating any
  // of its actual query/return-value logic.
  then<T>(onFulfilled?: (value: { data: unknown[]; error: null }) => T) {
    return Promise.resolve({ data: this.rows, error: null }).then(onFulfilled);
  }
}

function fakeCaseClientReturning(rows: unknown[]) {
  const builder = new RecordingCaseQueryBuilder(rows);
  const client = { from: () => builder } as unknown as SupabaseClient;

  return { client, builder };
}

function caseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    defendant: "Alex Rowan",
    act: "Entered the restricted lab.",
    exact_question: "Did Alex knowingly violate the lab protocol?",
    source_type: "MANUAL",
    source_filename: null,
    created_at: "2026-08-25T10:00:00.000Z",
    ...overrides
  };
}

describe("SupabaseCaseRepository.list() query contract (Milestone 11, Issue #27)", () => {
  it("requests created_at DESC, then id DESC directly from Postgres", async () => {
    const { client, builder } = fakeCaseClientReturning([caseRow()]);
    const repository = new SupabaseCaseRepository(client);

    await repository.list();

    const orderCalls = builder.calls.filter((call) => call.method === "order");

    expect(orderCalls).toEqual([
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "order", args: ["id", { ascending: false }] }
    ]);
  });

  it("does not re-sort the rows returned by the query builder client-side", async () => {
    // Fed in an order the DB's own ORDER BY would never actually
    // produce (older-first) -- if a client-side re-sort remained,
    // this would come back reordered. Proves the repository layer adds
    // no sort of its own on top of Postgres's.
    const older = caseRow({ id: "00000000-0000-4000-8000-000000000001", created_at: "2026-08-25T10:00:00.000Z" });
    const newer = caseRow({ id: "00000000-0000-4000-8000-000000000002", created_at: "2026-08-26T10:00:00.000Z" });
    const { client } = fakeCaseClientReturning([older, newer]);
    const repository = new SupabaseCaseRepository(client);

    const result = await repository.list();

    expect(result.map((row) => row.id)).toEqual([older.id, newer.id]);
  });

  it("preserves the query builder's exact order even when two rows' timestamps differ only by microseconds", async () => {
    // Postgres's timestamptz has microsecond resolution; JS Date/
    // Date.parse is millisecond-precision and would collapse these two
    // timestamps to the identical millisecond. A now-removed JS-side
    // re-sort would then have fallen through to an id-based tie-break,
    // which could reorder rows Postgres had already ordered correctly.
    // Deliberately fed in an order a lexicographic-id tie-break would
    // NOT produce, to prove no such reordering happens.
    const a = caseRow({ id: "aaaaaaaa-0000-4000-8000-000000000001", created_at: "2026-08-25T10:00:00.000001+00:00" });
    const b = caseRow({ id: "bbbbbbbb-0000-4000-8000-000000000002", created_at: "2026-08-25T10:00:00.000002+00:00" });
    const { client } = fakeCaseClientReturning([a, b]);
    const repository = new SupabaseCaseRepository(client);

    const result = await repository.list();

    expect(result.map((row) => row.id)).toEqual([a.id, b.id]);
  });
});
