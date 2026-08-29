-- Milestone 8 — Shared-Model Tribunal execution.
--
-- This migration is NOT applied to the real development database as part
-- of implementation. It requires an independent static audit before it
-- becomes historical remote state, matching the discipline already
-- established for the Milestone 5/6/7 migrations. Neither existing
-- migration is edited by this file -- this is a brand-new forward
-- migration.
--
-- Design contract: Issue #17 (M8 planning, corrected twice after
-- independent review), ARCHITECTURE.md Sec 4/8, SPEC.md Sec 9-17.

-- ---------------------------------------------------------------------
-- 1. tribunal_runs — the execution/economics columns Milestone 6
--    deliberately deferred (ARCHITECTURE.md Sec 8.2). All nullable: a
--    READY run has none of these populated yet.
-- ---------------------------------------------------------------------
alter table public.tribunal_runs
  add column started_at timestamptz null,
  add column completed_at timestamptz null,
  add column majority_verdict text null,
  add column failure_code text null,
  add column failure_message text null,
  add column total_input_tokens bigint null,
  add column total_output_tokens bigint null,
  add column total_tokens bigint null,
  add column advocate_cost_usd numeric null,
  add column judge_cost_usd numeric null,
  add column total_cost_usd numeric null;

alter table public.tribunal_runs
  add constraint tribunal_runs_majority_verdict_check check (
    majority_verdict is null or majority_verdict in ('GUILTY', 'NOT_GUILTY')
  );

-- No grant changes here -- service_role keeps exactly SELECT on
-- tribunal_runs (Milestone 6 Decision 6); every mutation below goes
-- through one of the narrowly-scoped SECURITY DEFINER functions in
-- Sec 4, never a direct UPDATE grant.

-- ---------------------------------------------------------------------
-- 2. model_call_attempts — one row per real provider attempt
--    (ARCHITECTURE.md Sec 8.4), extended with the route-identity/audit
--    columns the M8 implementation task's Attempt Audit section
--    requires beyond the original sketch (canonical_model_id,
--    provider_endpoint_tag, prompt_version, conservative_max_cost_usd)
--    -- the same audit-completeness idiom already established for
--    setup_extraction_attempts in Milestone 7A.
-- ---------------------------------------------------------------------
create table public.model_call_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.tribunal_runs (id),
  participant_config_id uuid not null references public.participant_configs (id),
  attempt_number smallint not null,
  status text not null,
  configured_model_id text not null,
  canonical_model_id text null,
  provider_endpoint_tag text null,
  prompt_version text not null,
  conservative_max_cost_usd numeric null,
  provider_request_id text null,

  input_tokens bigint null,
  output_tokens bigint null,
  total_tokens bigint null,
  input_price_per_million numeric null,
  output_price_per_million numeric null,
  actual_cost_usd numeric null,
  derived_cost_usd numeric null,
  pricing_observed_at timestamptz null,

  latency_ms bigint null,
  error_category text null,
  error_message text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,

  constraint model_call_attempts_participant_attempt_key
    unique (participant_config_id, attempt_number),
  constraint model_call_attempts_attempt_number_check check (
    attempt_number in (1, 2)
  ),
  constraint model_call_attempts_status_check check (
    status in (
      'CLAIMED',
      'SUCCESS',
      'INVALID_STRUCTURED_OUTPUT',
      'TIMEOUT',
      'PROVIDER_UNAVAILABLE',
      'UNKNOWN_OUTCOME'
    )
  )
);

alter table public.model_call_attempts enable row level security;
revoke all on table public.model_call_attempts from public, anon, authenticated, service_role;
grant select on table public.model_call_attempts to service_role;

-- ---------------------------------------------------------------------
-- 3. advocate_speeches / judge_verdicts / protocols
--    (ARCHITECTURE.md Sec 8.5-8.7, unchanged shapes).
-- ---------------------------------------------------------------------
create table public.advocate_speeches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.tribunal_runs (id),
  participant_config_id uuid not null unique references public.participant_configs (id),
  speech text not null,
  created_at timestamptz not null default now(),
  constraint advocate_speeches_speech_check check (char_length(btrim(speech)) > 0)
);

alter table public.advocate_speeches enable row level security;
revoke all on table public.advocate_speeches from public, anon, authenticated, service_role;
grant select on table public.advocate_speeches to service_role;

create table public.judge_verdicts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.tribunal_runs (id),
  participant_config_id uuid not null unique references public.participant_configs (id),
  verdict text not null,
  reasoning text not null,
  created_at timestamptz not null default now(),
  constraint judge_verdicts_verdict_check check (verdict in ('GUILTY', 'NOT_GUILTY')),
  constraint judge_verdicts_reasoning_check check (char_length(btrim(reasoning)) > 0)
);

alter table public.judge_verdicts enable row level security;
revoke all on table public.judge_verdicts from public, anon, authenticated, service_role;
grant select on table public.judge_verdicts to service_role;

create table public.protocols (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.tribunal_runs (id),
  schema_version text not null,
  protocol_json jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.protocols enable row level security;
revoke all on table public.protocols from public, anon, authenticated, service_role;
grant select on table public.protocols to service_role;

-- ---------------------------------------------------------------------
-- 4. Narrowly-scoped SECURITY DEFINER RPCs -- the only write paths for
--    every table above. Same discipline as the Milestone 6 freeze
--    function: SET search_path = '', schema-qualified references, no
--    dynamic SQL, no user-controlled identifiers, EXECUTE revoked from
--    PUBLIC/anon/authenticated and granted only to service_role. No
--    generic arbitrary run-update RPC is created -- each function does
--    exactly one narrow state transition or write.
-- ---------------------------------------------------------------------

-- 4a. READY -> BLOCKED_BUDGET (atomic; Issue #17 correction #1).
-- Idempotent for replay: a second call when the run is ALREADY
-- BLOCKED_BUDGET is a no-op success (the original reason is preserved,
-- not overwritten) rather than an error -- mirrors the freeze
-- function's own same-key/same-payload reuse semantics.
create function public.block_tribunal_run_budget(
  p_run_id uuid,
  p_reason_code text,
  p_reason_detail text
)
returns table (blocked boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
begin
  select status into v_current_status
  from public.tribunal_runs
  where id = p_run_id
  for update;

  if v_current_status is null then
    raise exception 'run not found' using errcode = '22023';
  end if;

  if v_current_status = 'BLOCKED_BUDGET' then
    return query select true;
    return;
  end if;

  if v_current_status <> 'READY' then
    return query select false;
    return;
  end if;

  update public.tribunal_runs
  set status = 'BLOCKED_BUDGET',
      failure_code = p_reason_code,
      failure_message = p_reason_detail
  where id = p_run_id and status = 'READY';

  return query select true;
end;
$$;

revoke execute on function public.block_tribunal_run_budget(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.block_tribunal_run_budget(uuid, text, text)
to service_role;

-- 4b. READY -> ADVOCATES_RUNNING (atomic; ARCHITECTURE.md Sec 4.2).
-- Mutually exclusive with 4a by construction: both predicates are
-- `WHERE status = 'READY'`, so whichever atomic UPDATE commits first
-- makes the other's predicate stop matching.
create function public.claim_tribunal_run_for_execution(
  p_run_id uuid
)
returns table (won_claim boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  update public.tribunal_runs
  set status = 'ADVOCATES_RUNNING', started_at = now()
  where id = p_run_id and status = 'READY'
  returning tribunal_runs.id into v_updated_id;

  return query select (v_updated_id is not null);
end;
$$;

revoke execute on function public.claim_tribunal_run_for_execution(uuid)
from public, anon, authenticated;
grant execute on function public.claim_tribunal_run_for_execution(uuid)
to service_role;

-- 4c. ADVOCATES_RUNNING -> JUDGES_RUNNING (atomic barrier transition).
create function public.transition_tribunal_run_to_judges(
  p_run_id uuid
)
returns table (transitioned boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  update public.tribunal_runs
  set status = 'JUDGES_RUNNING'
  where id = p_run_id and status = 'ADVOCATES_RUNNING'
  returning tribunal_runs.id into v_updated_id;

  return query select (v_updated_id is not null);
end;
$$;

revoke execute on function public.transition_tribunal_run_to_judges(uuid)
from public, anon, authenticated;
grant execute on function public.transition_tribunal_run_to_judges(uuid)
to service_role;

-- 4d. Terminal FAILED, from either running phase.
create function public.fail_tribunal_run(
  p_run_id uuid,
  p_failure_code text,
  p_failure_message text
)
returns table (transitioned boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  update public.tribunal_runs
  set status = 'FAILED',
      failure_code = p_failure_code,
      failure_message = p_failure_message,
      completed_at = now()
  where id = p_run_id and status in ('ADVOCATES_RUNNING', 'JUDGES_RUNNING')
  returning tribunal_runs.id into v_updated_id;

  return query select (v_updated_id is not null);
end;
$$;

revoke execute on function public.fail_tribunal_run(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.fail_tribunal_run(uuid, text, text)
to service_role;

-- 4e. Terminal COMPLETED -- deterministic aggregates + protocol,
-- computed by the calling application code (never this function --
-- majority/protocol assembly is plain deterministic code per SPEC.md
-- Sec 12/13, not a database concern) and persisted atomically together.
create function public.complete_tribunal_run(
  p_run_id uuid,
  p_majority_verdict text,
  p_total_input_tokens bigint,
  p_total_output_tokens bigint,
  p_total_tokens bigint,
  p_advocate_cost_usd numeric,
  p_judge_cost_usd numeric,
  p_total_cost_usd numeric,
  p_schema_version text,
  p_protocol_json jsonb
)
returns table (transitioned boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  if p_majority_verdict not in ('GUILTY', 'NOT_GUILTY') then
    raise exception 'invalid majority_verdict' using errcode = '22023';
  end if;

  update public.tribunal_runs
  set status = 'COMPLETED',
      majority_verdict = p_majority_verdict,
      total_input_tokens = p_total_input_tokens,
      total_output_tokens = p_total_output_tokens,
      total_tokens = p_total_tokens,
      advocate_cost_usd = p_advocate_cost_usd,
      judge_cost_usd = p_judge_cost_usd,
      total_cost_usd = p_total_cost_usd,
      completed_at = now()
  where id = p_run_id and status = 'JUDGES_RUNNING'
  returning tribunal_runs.id into v_updated_id;

  if v_updated_id is null then
    return query select false;
    return;
  end if;

  insert into public.protocols (run_id, schema_version, protocol_json)
  values (p_run_id, p_schema_version, p_protocol_json)
  on conflict (run_id) do nothing;

  return query select true;
end;
$$;

revoke execute on function public.complete_tribunal_run(
  uuid, text, bigint, bigint, bigint, numeric, numeric, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_tribunal_run(
  uuid, text, bigint, bigint, bigint, numeric, numeric, numeric, text, jsonb
) to service_role;

-- 4f. Claim one provider attempt for one participant/attempt number.
-- Race-safe by construction: participant_config_id + attempt_number is
-- UNIQUE, so a concurrent duplicate claim for the same logical call
-- observes a unique_violation and loses cleanly (won_claim = false),
-- exactly mirroring the Milestone 7A claim_setup_extraction_attempt_*
-- pattern.
create function public.claim_tribunal_attempt(
  p_run_id uuid,
  p_participant_config_id uuid,
  p_attempt_number smallint,
  p_configured_model_id text,
  p_canonical_model_id text,
  p_provider_endpoint_tag text,
  p_prompt_version text,
  p_conservative_max_cost_usd numeric
)
returns table (won_claim boolean, attempt_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
begin
  begin
    insert into public.model_call_attempts as attempt (
      run_id,
      participant_config_id,
      attempt_number,
      status,
      configured_model_id,
      canonical_model_id,
      provider_endpoint_tag,
      prompt_version,
      conservative_max_cost_usd
    )
    values (
      p_run_id,
      p_participant_config_id,
      p_attempt_number,
      'CLAIMED',
      p_configured_model_id,
      p_canonical_model_id,
      p_provider_endpoint_tag,
      p_prompt_version,
      p_conservative_max_cost_usd
    )
    returning attempt.id into v_attempt_id;
  exception
    when unique_violation then
      v_attempt_id := null;
  end;

  return query select (v_attempt_id is not null), v_attempt_id;
end;
$$;

revoke execute on function public.claim_tribunal_attempt(
  uuid, uuid, smallint, text, text, text, text, numeric
) from public, anon, authenticated;
grant execute on function public.claim_tribunal_attempt(
  uuid, uuid, smallint, text, text, text, text, numeric
) to service_role;

-- 4g. Terminalize a claimed attempt. Only ever moves a CLAIMED row to a
-- terminal status -- a second call against an already-terminal row is a
-- harmless no-op (zero rows updated), never overwrites a real outcome.
create function public.terminalize_tribunal_attempt(
  p_attempt_id uuid,
  p_status text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_actual_cost_usd numeric,
  p_latency_ms bigint,
  p_provider_request_id text,
  p_error_category text,
  p_error_message text
)
returns table (transitioned boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  if p_status = 'CLAIMED' then
    raise exception 'CLAIMED is not a terminal status' using errcode = '22023';
  end if;

  update public.model_call_attempts
  set status = p_status,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      total_tokens = case
        when p_input_tokens is null or p_output_tokens is null then null
        else p_input_tokens + p_output_tokens
      end,
      actual_cost_usd = p_actual_cost_usd,
      latency_ms = p_latency_ms,
      provider_request_id = p_provider_request_id,
      error_category = p_error_category,
      error_message = p_error_message,
      completed_at = now()
  where id = p_attempt_id and status = 'CLAIMED'
  returning model_call_attempts.id into v_updated_id;

  return query select (v_updated_id is not null);
end;
$$;

revoke execute on function public.terminalize_tribunal_attempt(
  uuid, text, bigint, bigint, numeric, bigint, text, text, text
) from public, anon, authenticated;
grant execute on function public.terminalize_tribunal_attempt(
  uuid, text, bigint, bigint, numeric, bigint, text, text, text
) to service_role;

-- 4h. Persist one validated advocate speech. Idempotent: ON CONFLICT DO
-- NOTHING against the participant_config_id UNIQUE constraint means a
-- duplicate persist call (e.g. after a retry that ultimately succeeded
-- on both attempts, which never happens under the one-retry-max policy,
-- but defensively) never overwrites the first-persisted speech.
create function public.persist_advocate_speech(
  p_run_id uuid,
  p_participant_config_id uuid,
  p_speech text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.advocate_speeches (run_id, participant_config_id, speech)
  values (p_run_id, p_participant_config_id, p_speech)
  on conflict (participant_config_id) do nothing;
$$;

revoke execute on function public.persist_advocate_speech(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.persist_advocate_speech(uuid, uuid, text)
to service_role;

-- 4i. Persist one validated judge verdict. Same idempotent-insert idiom.
create function public.persist_judge_verdict(
  p_run_id uuid,
  p_participant_config_id uuid,
  p_verdict text,
  p_reasoning text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.judge_verdicts (run_id, participant_config_id, verdict, reasoning)
  values (p_run_id, p_participant_config_id, p_verdict, p_reasoning)
  on conflict (participant_config_id) do nothing;
$$;

revoke execute on function public.persist_judge_verdict(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.persist_judge_verdict(uuid, uuid, text, text)
to service_role;
