-- Milestone 7A — Smart Tribunal Package Extraction persistence.
--
-- This migration is NOT applied to any linked remote Supabase project as
-- part of this implementation task (Section 33/41 of the implementation
-- instructions) -- it is reviewed first, matching the M5/M6 lesson that a
-- migration is not trusted merely because it typechecks against local
-- expectations.
--
-- Design contract: docs/adr/0004-smart-package-extraction.md,
-- Decisions 13, 15, 16, 19. Mirrors Milestone 6's
-- 20260825214212_participant_configuration.sql atomic-claim discipline
-- (SECURITY DEFINER, `set search_path = ''`, race-safe insert-then-catch
-- rather than SELECT-then-INSERT, no user-controlled identifiers, exact
-- revoke/grant pattern) -- neither existing migration is modified here.

-- ---------------------------------------------------------------------
-- 1. setup_extractions — one row per logical extraction call.
-- ---------------------------------------------------------------------
create table public.setup_extractions (
  -- Client-generated UUID (extractionRequestId, ADR Decision 15) -- never
  -- server-generated, mirroring tribunal_runs.client_request_id's role as
  -- the idempotency key, but here it IS the primary key rather than a
  -- separate unique column.
  id uuid primary key,
  -- Implementation-time decision A (Issue #15): standalone, no FK. Smart
  -- Import runs before a case necessarily exists (ADR Decision 2's flow:
  -- New Case -> Smart Import -> ... -> Convene); back-filling once a case
  -- is later created is out of scope for this pass.
  case_id uuid null,
  -- Audit/UI metadata only -- NEVER part of the semantic fingerprint
  -- (ADR Decision 15, locked: source.kind is excluded).
  source_type text not null,
  -- SHA-256 lowercase hex digest over {normalized dossier text, frozen
  -- prompt_version, frozen configured_model_id} -- never source.kind,
  -- never raw dossier content itself.
  request_fingerprint text not null,
  -- Frozen at first acceptance (ADR Decision 15's "Frozen logical-call
  -- semantic identity", sixth planning pass) -- never rewritten once set.
  prompt_version text not null,
  configured_model_id text not null,
  -- null while no terminal outcome yet exists for this logical call.
  final_status text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,

  constraint setup_extractions_source_type_check check (
    source_type in ('PASTED_TEXT', 'TXT_FILE', 'MD_FILE', 'PDF_FILE')
  ),

  constraint setup_extractions_request_fingerprint_format check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),

  -- Same structural bound/character-class rule as M6's
  -- participant_configs_model_id_check (1..256 chars, no C0/DEL) --
  -- configured_model_id is server-only configuration, never
  -- browser-supplied, but this is defense in depth at the one write path.
  constraint setup_extractions_configured_model_id_check check (
    char_length(configured_model_id) between 1 and 256
    and configured_model_id !~ '[\x01-\x1f\x7f]'
  ),

  constraint setup_extractions_prompt_version_check check (
    char_length(prompt_version) between 1 and 128
    and prompt_version !~ '[\x01-\x1f\x7f]'
  ),

  -- Never CLAIMED (an attempt-only transient status), never
  -- IDEMPOTENCY_CONFLICT or RATE_LIMITED (neither is ever persisted to
  -- any row -- both are pure request-rejections with zero writes,
  -- ADR Decisions 13/19).
  constraint setup_extractions_final_status_check check (
    final_status is null
    or final_status in (
      'INPUT_INVALID', 'UNSUPPORTED_FILE_TYPE', 'FILE_TOO_LARGE',
      'PDF_TEXT_UNAVAILABLE', 'PDF_ENCRYPTED_OR_INVALID', 'NORMALIZED_TEXT_EMPTY',
      'INPUT_TOO_LARGE_FOR_MODEL', 'MODEL_NOT_ELIGIBLE', 'PRICING_UNAVAILABLE',
      'BLOCKED_BUDGET', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'INVALID_STRUCTURED_OUTPUT',
      'INPUT_PROCESSING_TIMEOUT', 'PROMPT_VERSION_UNAVAILABLE',
      'SUCCESS', 'EXTRACTION_INCOMPLETE', 'EXTRACTION_AMBIGUOUS', 'UNKNOWN_OUTCOME'
    )
  )
);

alter table public.setup_extractions enable row level security;

revoke all on table public.setup_extractions from public, anon, authenticated, service_role;
grant select on table public.setup_extractions to service_role;

-- ---------------------------------------------------------------------
-- 2. setup_extraction_attempts — one row per provider-attempt SLOT,
--    claimed before spend (ADR Decision 15's claim-then-spend
--    invariant). Attempt numbers 1 or 2 only -- no attempt 3.
-- ---------------------------------------------------------------------
create table public.setup_extraction_attempts (
  id uuid primary key default gen_random_uuid(),
  extraction_request_id uuid not null references public.setup_extractions (id),
  attempt_number int not null,
  -- CLAIMED is the first value, set atomically before any provider call;
  -- transitions exactly once to one terminal value.
  status text not null,
  -- Fixed at claim time, before the provider call -- the exact
  -- route/pricing snapshot that authorized this attempt.
  canonical_model_id text not null,
  provider_endpoint_tag text not null,
  conservative_max_cost_usd numeric not null,
  -- Recorded whenever the provider supplied it, regardless of the
  -- application-level outcome (ADR Decision 14) -- never phrased as
  -- "only on success."
  actual_input_tokens int null,
  actual_output_tokens int null,
  actual_cost_usd numeric null,
  latency_ms int null,
  provider_request_id text null,
  error_code text null,
  -- Populated ONLY when this attempt reaches SUCCESS/
  -- EXTRACTION_INCOMPLETE/EXTRACTION_AMBIGUOUS -- shaped exactly like
  -- packageExtractionSchema's output (src/schemas/packageExtraction.ts);
  -- never the provider's raw response (ADR Decision 13, added the fourth
  -- planning pass for lost-response recovery).
  validated_result jsonb null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,

  constraint setup_extraction_attempts_extraction_key_unique
    unique (extraction_request_id, attempt_number),

  constraint setup_extraction_attempts_attempt_number_check check (
    attempt_number in (1, 2)
  ),

  -- Only the statuses an ATTEMPT row can actually reach (Decision 13/16)
  -- -- every other hard-failure/RATE_LIMITED code is a pre-claim
  -- rejection that never creates an attempt row at all, and is instead
  -- reflected only on setup_extractions.final_status, if anywhere.
  constraint setup_extraction_attempts_status_check check (
    status in (
      'CLAIMED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'INVALID_STRUCTURED_OUTPUT',
      'INPUT_PROCESSING_TIMEOUT', 'SUCCESS', 'EXTRACTION_INCOMPLETE',
      'EXTRACTION_AMBIGUOUS', 'UNKNOWN_OUTCOME'
    )
  ),

  constraint setup_extraction_attempts_canonical_model_id_check check (
    char_length(canonical_model_id) between 1 and 256
    and canonical_model_id !~ '[\x01-\x1f\x7f]'
  ),

  constraint setup_extraction_attempts_provider_endpoint_tag_check check (
    char_length(provider_endpoint_tag) between 1 and 256
    and provider_endpoint_tag !~ '[\x01-\x1f\x7f]'
  ),

  constraint setup_extraction_attempts_conservative_cost_check check (
    conservative_max_cost_usd >= 0
  ),
  constraint setup_extraction_attempts_actual_cost_check check (
    actual_cost_usd is null or actual_cost_usd >= 0
  ),
  constraint setup_extraction_attempts_actual_input_tokens_check check (
    actual_input_tokens is null or actual_input_tokens >= 0
  ),
  constraint setup_extraction_attempts_actual_output_tokens_check check (
    actual_output_tokens is null or actual_output_tokens >= 0
  ),
  constraint setup_extraction_attempts_latency_check check (
    latency_ms is null or latency_ms >= 0
  ),

  -- validated_result is populated if and only if the terminal status is
  -- one of the three success/needs-review outcomes -- never for any
  -- hard-failure status, and never left null for one of these three.
  constraint setup_extraction_attempts_validated_result_consistency check (
    (status in ('SUCCESS', 'EXTRACTION_INCOMPLETE', 'EXTRACTION_AMBIGUOUS') and validated_result is not null)
    or (status not in ('SUCCESS', 'EXTRACTION_INCOMPLETE', 'EXTRACTION_AMBIGUOUS') and validated_result is null)
  )
);

alter table public.setup_extraction_attempts enable row level security;

revoke all on table public.setup_extraction_attempts from public, anon, authenticated, service_role;
grant select on table public.setup_extraction_attempts to service_role;

-- ---------------------------------------------------------------------
-- 3. claim_setup_extraction_attempt_one — the only write path that can
--    create BOTH a new setup_extractions row and its attempt #1 row
--    (ADR Decision 15's atomic pre-spend claim mechanism, mirroring
--    freeze_participant_configuration's insert-then-catch-unique-
--    violation pattern exactly).
-- ---------------------------------------------------------------------
create function public.claim_setup_extraction_attempt_one(
  p_extraction_id uuid,
  p_source_type text,
  p_request_fingerprint text,
  p_prompt_version text,
  p_configured_model_id text,
  p_canonical_model_id text,
  p_provider_endpoint_tag text,
  p_conservative_max_cost_usd numeric
)
returns table (
  extraction_id uuid,
  won_claim boolean,
  attempt_id uuid,
  attempt_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_attempt_id uuid;
  v_stored_fingerprint text;
  v_existing_attempt record;
begin
  if p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid request_fingerprint' using errcode = '22023';
  end if;

  -- Race-safe by construction: attempt the logical-extraction insert
  -- directly, never SELECT-then-INSERT. Exactly one concurrent caller
  -- can win this insert for a given id.
  begin
    insert into public.setup_extractions as se (
      id, case_id, source_type, request_fingerprint, prompt_version, configured_model_id
    )
    values (
      p_extraction_id, null, p_source_type, p_request_fingerprint, p_prompt_version, p_configured_model_id
    );
  exception
    when unique_violation then
      null; -- another caller already created this id -- fall through.
  end;

  -- Opportunistic stale-claim reconciliation for THIS id's attempt #1
  -- (ADR Decision 13): runs unconditionally here, whether this call just
  -- created the row or is joining an already-existing one -- no
  -- background worker required.
  update public.setup_extraction_attempts as sea
  set status = 'UNKNOWN_OUTCOME', completed_at = now()
  where sea.extraction_request_id = p_extraction_id
    and sea.attempt_number = 1
    and sea.status = 'CLAIMED'
    and sea.created_at < now() - interval '120 seconds';

  select se.request_fingerprint into v_stored_fingerprint
  from public.setup_extractions as se
  where se.id = p_extraction_id;

  if v_stored_fingerprint is distinct from p_request_fingerprint then
    raise exception 'idempotency_conflict' using errcode = 'P0001', hint = 'idempotency_conflict';
  end if;

  -- Attempt the claim insert. UNIQUE(extraction_request_id, attempt_number)
  -- is the race-safe boundary: at most one concurrent caller ever wins.
  begin
    insert into public.setup_extraction_attempts as sea (
      extraction_request_id, attempt_number, status,
      canonical_model_id, provider_endpoint_tag, conservative_max_cost_usd
    )
    values (
      p_extraction_id, 1, 'CLAIMED',
      p_canonical_model_id, p_provider_endpoint_tag, p_conservative_max_cost_usd
    )
    returning sea.id into v_new_attempt_id;
  exception
    when unique_violation then
      v_new_attempt_id := null;
  end;

  if v_new_attempt_id is not null then
    return query select p_extraction_id, true, v_new_attempt_id, 'CLAIMED'::text;
    return;
  end if;

  -- Lost the claim (or it was already resolved): return the existing
  -- attempt #1's current state -- the caller makes zero provider calls.
  select sea.id, sea.status into v_existing_attempt
  from public.setup_extraction_attempts as sea
  where sea.extraction_request_id = p_extraction_id and sea.attempt_number = 1;

  return query select p_extraction_id, false, v_existing_attempt.id, v_existing_attempt.status;
end;
$$;

revoke execute on function public.claim_setup_extraction_attempt_one(
  uuid, text, text, text, text, text, text, numeric
) from public, anon, authenticated;
grant execute on function public.claim_setup_extraction_attempt_one(
  uuid, text, text, text, text, text, text, numeric
) to service_role;

-- ---------------------------------------------------------------------
-- 4. claim_setup_extraction_attempt_two — the only write path for a
--    retry claim. Requires attempt #1 to already be terminal and
--    retryable; never creates the logical setup_extractions row itself.
-- ---------------------------------------------------------------------
create function public.claim_setup_extraction_attempt_two(
  p_extraction_id uuid,
  p_request_fingerprint text,
  p_canonical_model_id text,
  p_provider_endpoint_tag text,
  p_conservative_max_cost_usd numeric
)
returns table (
  extraction_id uuid,
  won_claim boolean,
  attempt_id uuid,
  attempt_status text,
  block_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stored_fingerprint text;
  v_attempt_one_status text;
  v_new_attempt_id uuid;
  v_existing_two record;
begin
  select se.request_fingerprint into v_stored_fingerprint
  from public.setup_extractions as se
  where se.id = p_extraction_id;

  if v_stored_fingerprint is null then
    return query select p_extraction_id, false, null::uuid, null::text, 'NOT_FOUND'::text;
    return;
  end if;

  if v_stored_fingerprint is distinct from p_request_fingerprint then
    raise exception 'idempotency_conflict' using errcode = 'P0001', hint = 'idempotency_conflict';
  end if;

  update public.setup_extraction_attempts as sea
  set status = 'UNKNOWN_OUTCOME', completed_at = now()
  where sea.extraction_request_id = p_extraction_id
    and sea.attempt_number = 1
    and sea.status = 'CLAIMED'
    and sea.created_at < now() - interval '120 seconds';

  select sea.status into v_attempt_one_status
  from public.setup_extraction_attempts as sea
  where sea.extraction_request_id = p_extraction_id and sea.attempt_number = 1;

  if v_attempt_one_status is null or v_attempt_one_status = 'CLAIMED' then
    return query select p_extraction_id, false, null::uuid, null::text, 'ATTEMPT_ONE_NOT_TERMINAL'::text;
    return;
  end if;

  if v_attempt_one_status not in ('PROVIDER_UNAVAILABLE', 'TIMEOUT', 'INVALID_STRUCTURED_OUTPUT', 'UNKNOWN_OUTCOME') then
    return query select p_extraction_id, false, null::uuid, null::text, 'ATTEMPT_ONE_NOT_RETRYABLE'::text;
    return;
  end if;

  begin
    insert into public.setup_extraction_attempts as sea (
      extraction_request_id, attempt_number, status,
      canonical_model_id, provider_endpoint_tag, conservative_max_cost_usd
    )
    values (
      p_extraction_id, 2, 'CLAIMED',
      p_canonical_model_id, p_provider_endpoint_tag, p_conservative_max_cost_usd
    )
    returning sea.id into v_new_attempt_id;
  exception
    when unique_violation then
      v_new_attempt_id := null;
  end;

  if v_new_attempt_id is not null then
    return query select p_extraction_id, true, v_new_attempt_id, 'CLAIMED'::text, null::text;
    return;
  end if;

  select sea.id, sea.status into v_existing_two
  from public.setup_extraction_attempts as sea
  where sea.extraction_request_id = p_extraction_id and sea.attempt_number = 2;

  return query select p_extraction_id, false, v_existing_two.id, v_existing_two.status, 'ALREADY_CLAIMED_OR_TERMINAL'::text;
end;
$$;

revoke execute on function public.claim_setup_extraction_attempt_two(
  uuid, text, text, text, numeric
) from public, anon, authenticated;
grant execute on function public.claim_setup_extraction_attempt_two(
  uuid, text, text, text, numeric
) to service_role;

-- ---------------------------------------------------------------------
-- 5. terminalize_setup_extraction_attempt — the ONE permitted status
--    transition off CLAIMED (ADR Decision 13). Conditioned on
--    `status = 'CLAIMED'` (compare-and-swap) so a late finalization
--    arriving after a concurrent stale-claim reconciliation can never
--    overwrite an already-terminal UNKNOWN_OUTCOME row -- it silently
--    no-ops instead.
-- ---------------------------------------------------------------------
create function public.terminalize_setup_extraction_attempt(
  p_extraction_id uuid,
  p_attempt_number int,
  p_status text,
  p_actual_input_tokens int,
  p_actual_output_tokens int,
  p_actual_cost_usd numeric,
  p_latency_ms int,
  p_provider_request_id text,
  p_error_code text,
  p_validated_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if p_status = 'CLAIMED' or p_status not in (
    'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'INVALID_STRUCTURED_OUTPUT',
    'INPUT_PROCESSING_TIMEOUT', 'SUCCESS', 'EXTRACTION_INCOMPLETE',
    'EXTRACTION_AMBIGUOUS', 'UNKNOWN_OUTCOME'
  ) then
    raise exception 'invalid terminal status' using errcode = '22023';
  end if;

  update public.setup_extraction_attempts as sea
  set status = p_status,
      actual_input_tokens = p_actual_input_tokens,
      actual_output_tokens = p_actual_output_tokens,
      actual_cost_usd = p_actual_cost_usd,
      latency_ms = p_latency_ms,
      provider_request_id = p_provider_request_id,
      error_code = p_error_code,
      validated_result = p_validated_result,
      completed_at = now()
  where sea.extraction_request_id = p_extraction_id
    and sea.attempt_number = p_attempt_number
    and sea.status = 'CLAIMED';

  get diagnostics v_updated = row_count;

  -- v_updated = 0 means a concurrent stale-claim reconciliation (or
  -- another finalization) already moved this row out of CLAIMED --
  -- silently no-op rather than clobbering an already-terminal state.
  if v_updated = 1 then
    update public.setup_extractions as se
    set final_status = p_status, completed_at = now()
    where se.id = p_extraction_id;
  end if;
end;
$$;

revoke execute on function public.terminalize_setup_extraction_attempt(
  uuid, int, text, int, int, numeric, int, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.terminalize_setup_extraction_attempt(
  uuid, int, text, int, int, numeric, int, text, text, jsonb
) to service_role;

-- ---------------------------------------------------------------------
-- 6. block_setup_extraction — writes a terminal blocked final_status for
--    a guard failure that occurs BEFORE any claim is attempted
--    (ADR Decision 13's "no-spend block persistence," pre-claim case).
--    Creates the logical row (if new) with zero attempt rows -- never a
--    fake provider-attempt row for work that never reached a provider
--    attempt.
-- ---------------------------------------------------------------------
create function public.block_setup_extraction(
  p_extraction_id uuid,
  p_source_type text,
  p_request_fingerprint text,
  p_prompt_version text,
  p_configured_model_id text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in (
    'INPUT_INVALID', 'UNSUPPORTED_FILE_TYPE', 'FILE_TOO_LARGE',
    'PDF_TEXT_UNAVAILABLE', 'PDF_ENCRYPTED_OR_INVALID', 'NORMALIZED_TEXT_EMPTY',
    'INPUT_TOO_LARGE_FOR_MODEL', 'MODEL_NOT_ELIGIBLE', 'PRICING_UNAVAILABLE',
    'BLOCKED_BUDGET', 'INPUT_PROCESSING_TIMEOUT', 'PROMPT_VERSION_UNAVAILABLE'
  ) then
    raise exception 'invalid block status' using errcode = '22023';
  end if;

  insert into public.setup_extractions as se (
    id, case_id, source_type, request_fingerprint, prompt_version, configured_model_id, final_status, completed_at
  )
  values (
    p_extraction_id, null, p_source_type, p_request_fingerprint, p_prompt_version, p_configured_model_id, p_status, now()
  )
  on conflict (id) do update
  set final_status = p_status, completed_at = now();
end;
$$;

revoke execute on function public.block_setup_extraction(
  uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.block_setup_extraction(
  uuid, text, text, text, text, text
) to service_role;
