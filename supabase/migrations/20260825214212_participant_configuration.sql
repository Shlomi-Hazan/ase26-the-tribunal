-- Milestone 6 — Participant Configuration.
--
-- This migration is NOT applied to the real development database as part
-- of implementation. It is reviewed first (see
-- docs/verification/milestone-6-participant-configuration.md), matching
-- the lesson learned in Milestone 5: a migration is not trusted merely
-- because it typechecks against local expectations.
--
-- Design contract: docs/adr/0002-participant-configuration-freeze.md.
-- Neither existing Milestone 5 migration is modified by this file.

-- ---------------------------------------------------------------------
-- 1. Case idempotency for Convene-created cases (ADR Decision 9).
-- ---------------------------------------------------------------------
-- Nullable, unique-when-non-null. Standard PostgreSQL UNIQUE semantics
-- allow any number of NULL rows, so standalone M5 "Save Case" (which
-- always writes NULL here) is completely unaffected. This column is
-- internal persistence metadata only -- the case repository's explicit
-- select-column-list already excludes it from any public response, and
-- no browser/public grant is added.
alter table public.cases
  add column convene_request_id text null;

alter table public.cases
  add constraint cases_convene_request_id_key unique (convene_request_id);

-- No other cases column, constraint, RLS setting, or grant changes.
-- service_role keeps exactly SELECT + INSERT on cases, as established in
-- 20260825000000_create_cases.sql; no UPDATE/DELETE is introduced.

-- ---------------------------------------------------------------------
-- 2. tribunal_runs — minimal Milestone 6 acceptance/freeze columns only.
-- ---------------------------------------------------------------------
-- Execution/economics/failure/timing columns (majority_verdict, token and
-- cost totals, failure_code/failure_message, started_at, completed_at)
-- are Milestone 8/10 concerns and are deliberately NOT created here; they
-- will arrive via their own forward migration when actually needed.
create table public.tribunal_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id),
  client_request_id text not null,
  -- SHA-256 lowercase hex digest of the canonical semantic request
  -- (never a generated case UUID -- see ADR Decision 11). The exact
  -- format is enforced below as defense in depth.
  request_fingerprint text not null,
  execution_mode text not null,
  -- M6 itself only ever writes READY. The full vocabulary is already
  -- fixed by SPEC.md Sec 14; constraining against the complete list now
  -- avoids a future ALTER purely to widen it when M8 starts using the
  -- other values.
  status text not null,
  created_at timestamptz not null default now(),
  constraint tribunal_runs_client_request_id_key unique (client_request_id),
  constraint tribunal_runs_execution_mode_check check (
    execution_mode in ('SHARED', 'SEPARATE')
  ),
  constraint tribunal_runs_status_check check (
    status in (
      'DRAFT',
      'READY',
      'ADVOCATES_RUNNING',
      'JUDGES_RUNNING',
      'COMPLETED',
      'FAILED',
      'BLOCKED_BUDGET'
    )
  ),
  -- Exactly 64 lowercase hex characters. No chr(0)/NUL-construction
  -- expression is used anywhere in this migration (see the Milestone 5
  -- incident this project already hit and fixed in
  -- 20260825204419_fix_cases_source_filename_check.sql) -- this is a
  -- plain literal-character-class regex, the same proven-safe pattern
  -- family already exercised successfully against the real database by
  -- that fix (e.g. its `!~ '[/\\]'` clause).
  constraint tribunal_runs_request_fingerprint_format check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  )
);

alter table public.tribunal_runs enable row level security;

-- Explicit revoke-then-grant, matching the pattern already established
-- for cases, regardless of any project-level default-privilege
-- configuration. No application-facing role (PUBLIC, anon, authenticated,
-- service_role) receives INSERT/UPDATE/DELETE here. service_role gets
-- SELECT only -- the freeze function below is the *only* write path (see
-- Sec 4).
revoke all on table public.tribunal_runs from public, anon, authenticated, service_role;
grant select on table public.tribunal_runs to service_role;

-- ---------------------------------------------------------------------
-- 3. participant_configs — exactly seven rows per run.
-- ---------------------------------------------------------------------
create table public.participant_configs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.tribunal_runs (id),
  -- The application's established internal ParticipantId convention
  -- only (src/schemas/tribunalSetup.ts). This is a different, narrower
  -- namespace than the Milestone 5 Tribunal Package seat identifiers
  -- (PRO_1, CON_1, JUDGE_1, ...), which are never persisted here.
  participant_key text not null,
  role text not null,
  side text null,
  profile_name text null,
  personality_text text not null,
  personality_source text not null,
  personality_source_filename text null,
  model_id text not null,
  -- Application-owned placeholder until Milestone 7 real prompts exist
  -- (ADR Decision 12). Never a caller-supplied value -- the freeze
  -- function below writes this literal itself.
  prompt_version text not null,
  created_at timestamptz not null default now(),

  constraint participant_configs_run_key_unique unique (run_id, participant_key),

  constraint participant_configs_participant_key_check check (
    participant_key in (
      'advocate-pro-1',
      'advocate-pro-2',
      'advocate-con-1',
      'advocate-con-2',
      'judge-1',
      'judge-2',
      'judge-3'
    )
  ),

  constraint participant_configs_role_check check (role in ('ADVOCATE', 'JUDGE')),

  constraint participant_configs_side_check check (side in ('PRO', 'CON')),

  -- Fixed application-owned role/side per seat -- defense in depth behind
  -- the freeze function deriving these internally rather than accepting
  -- them as caller parameters at all.
  constraint participant_configs_role_side_consistency check (
    (
      participant_key in ('advocate-pro-1', 'advocate-pro-2')
      and role = 'ADVOCATE'
      and side = 'PRO'
    )
    or (
      participant_key in ('advocate-con-1', 'advocate-con-2')
      and role = 'ADVOCATE'
      and side = 'CON'
    )
    or (
      participant_key in ('judge-1', 'judge-2', 'judge-3')
      and role = 'JUDGE'
      and side is null
    )
  ),

  constraint participant_configs_profile_name_check check (
    profile_name is null
    or char_length(profile_name) between 1 and 120
  ),

  constraint participant_configs_personality_text_check check (
    char_length(btrim(personality_text)) between 1 and 4000
  ),

  constraint participant_configs_personality_source_check check (
    personality_source in ('manual', 'individual_file', 'tribunal_package')
  ),

  -- Safe-filename rules mirror the already-proven-safe pattern from the
  -- fixed cases migration (20260825204419_...): length bound, exact
  -- "." / ".." rejection, and path-separator rejection via plain
  -- equality/character-class checks -- deliberately no chr(0)/NUL-
  -- construction expression anywhere.
  constraint participant_configs_source_filename_check check (
    personality_source_filename is null
    or (
      char_length(personality_source_filename) between 1 and 255
      and personality_source_filename not in ('.', '..')
      and personality_source_filename !~ '[/\\]'
      and personality_source_filename ~* '\.(txt|md)$'
    )
  ),

  -- Cross-field: manual carries no filename; individual_file/
  -- tribunal_package require one (ADR Decision 5).
  constraint participant_configs_source_filename_required check (
    (personality_source = 'manual' and personality_source_filename is null)
    or (
      personality_source in ('individual_file', 'tribunal_package')
      and personality_source_filename is not null
    )
  ),

  -- Structural bound only (ADR Decision 14) -- 1..256 chars, reject C0
  -- control characters and DEL. NUL (\x00) is deliberately excluded from
  -- this expression: PostgreSQL text cannot structurally contain a NUL
  -- byte at all (the exact defect this project already hit and fixed),
  -- so no pattern needs to defend against it, and no chr(0)-style
  -- construction is used. This bracket-range hex-escape regex should be
  -- confirmed against the real database during migration review before
  -- this migration is applied, consistent with this project's
  -- do-not-trust-a-migration-until-live-tested discipline.
  constraint participant_configs_model_id_check check (
    char_length(model_id) between 1 and 256
    and model_id !~ '[\x01-\x1f\x7f]'
  )
);

alter table public.participant_configs enable row level security;

revoke all on table public.participant_configs from public, anon, authenticated, service_role;
grant select on table public.participant_configs to service_role;

-- ---------------------------------------------------------------------
-- 4. Freeze function -- the only write path for tribunal_runs and
--    participant_configs (ADR Decision 6).
-- ---------------------------------------------------------------------
-- SECURITY DEFINER is required because service_role itself has no
-- INSERT on either table above; this function is the one narrowly
-- scoped exception, not a bypass of the invariant -- it is the thing
-- that enforces it. SET search_path = '' plus fully schema-qualified
-- references prevent search-path injection. No dynamic SQL. No
-- user-controlled identifiers: role/side/prompt_version are derived
-- internally from a fixed mapping of the seven known participant keys,
-- never accepted as caller parameters.
create function public.freeze_participant_configuration(
  p_case_id uuid,
  p_client_request_id text,
  p_request_fingerprint text,
  p_execution_mode text,
  p_participants jsonb
)
returns table (
  id uuid,
  case_id uuid,
  client_request_id text,
  execution_mode text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_run_id uuid;
  v_existing record;
  v_participant jsonb;
  v_key text;
  v_role text;
  v_side text;
  v_keys text[];
  v_model_ids text[];
  v_model_id text;
begin
  if p_execution_mode not in ('SHARED', 'SEPARATE') then
    raise exception 'invalid execution_mode' using errcode = '22023';
  end if;

  if p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid request_fingerprint' using errcode = '22023';
  end if;

  if jsonb_typeof(p_participants) is distinct from 'array' then
    raise exception 'participant_configs must be an array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_participants) <> 7 then
    raise exception 'exactly seven participant configs are required' using errcode = '22023';
  end if;

  -- Exactly the seven known keys, no duplicates, no unknown eighth key:
  -- the sorted key set must equal the canonical sorted key set.
  select array_agg(elem ->> 'participant_key' order by elem ->> 'participant_key')
  into v_keys
  from jsonb_array_elements(p_participants) as elem;

  if v_keys is distinct from array[
    'advocate-con-1',
    'advocate-con-2',
    'advocate-pro-1',
    'advocate-pro-2',
    'judge-1',
    'judge-2',
    'judge-3'
  ] then
    raise exception 'participant_configs must contain exactly the seven known participant keys'
      using errcode = '22023';
  end if;

  -- Independent DB-level Shared-mode model_id invariant (pre-live
  -- correction). The Netlify Zod layer already rejects a Shared request
  -- whose seven model IDs differ, but this function is the sole
  -- structural write path and must not trust the caller merely because
  -- ordinary server code already validated the request -- a direct RPC
  -- caller (or a future code path) must be unable to bypass it. This
  -- also independently rejects a missing, null, blank, or otherwise
  -- structurally invalid model_id in either mode, before any row is
  -- written -- the same 1..256-char, no-C0/DEL bound as
  -- participant_configs_model_id_check, checked here too so a bad
  -- model_id fails with a plain input/validation error rather than
  -- surfacing as a CHECK-constraint violation deep inside the
  -- participant insert loop below.
  select array_agg(btrim(elem ->> 'model_id') order by elem ->> 'participant_key')
  into v_model_ids
  from jsonb_array_elements(p_participants) as elem;

  foreach v_model_id in array v_model_ids loop
    if v_model_id is null
      or char_length(v_model_id) < 1
      or char_length(v_model_id) > 256
      or v_model_id ~ '[\x01-\x1f\x7f]'
    then
      raise exception 'invalid or missing model_id' using errcode = '22023';
    end if;
  end loop;

  if p_execution_mode = 'SHARED' then
    if (select count(distinct m) from unnest(v_model_ids) as m) <> 1 then
      raise exception
        'shared execution mode requires all seven participants to use the same model_id'
        using errcode = '22023';
    end if;
  end if;

  -- Race-safe by construction: attempt the insert directly rather than
  -- SELECT-then-INSERT. The UNIQUE(client_request_id) constraint
  -- arbitrates concurrent identical requests; exactly one wins, the
  -- other falls through to the compare-and-decide branch below.
  --
  -- "AS new_run" + "RETURNING new_run.id" (rather than a bare "RETURNING
  -- id") is required, not stylistic: this function's RETURNS TABLE
  -- clause declares "id" (and case_id/client_request_id/execution_mode/
  -- status/created_at) as PL/pgSQL output-parameter variables in scope
  -- for the whole function body. Postgres's default
  -- plpgsql.variable_conflict = 'error' makes a bare "id" inside this
  -- INSERT's RETURNING clause ambiguous between that output variable and
  -- the tribunal_runs.id column, raising "column reference is
  -- ambiguous" at execution time. Qualifying with the table alias
  -- resolves it unambiguously in favor of the column, per
  -- https://www.postgresql.org/docs/current/sql-insert.html (INSERT
  -- INTO table_name [ AS alias ]; RETURNING may reference that alias)
  -- and https://www.postgresql.org/docs/current/plpgsql-implementation.html
  -- (qualifying a column reference with its table alias resolves the
  -- conflict even under variable_conflict = error).
  begin
    insert into public.tribunal_runs as new_run (
      case_id,
      client_request_id,
      request_fingerprint,
      execution_mode,
      status
    )
    values (
      p_case_id,
      p_client_request_id,
      p_request_fingerprint,
      p_execution_mode,
      'READY'
    )
    returning new_run.id into v_new_run_id;
  exception
    when unique_violation then
      v_new_run_id := null;
  end;

  if v_new_run_id is not null then
    -- Won the race (or was first): insert exactly seven participant
    -- rows. Any failure here (a CHECK violation, for example) propagates
    -- out of this function and rolls back the whole invocation,
    -- including the run insert above -- never 1 run + 1..6 configs.
    for v_participant in select * from jsonb_array_elements(p_participants)
    loop
      v_key := v_participant ->> 'participant_key';

      v_role := case
        when v_key in (
          'advocate-pro-1', 'advocate-pro-2', 'advocate-con-1', 'advocate-con-2'
        ) then 'ADVOCATE'
        else 'JUDGE'
      end;

      v_side := case
        when v_key in ('advocate-pro-1', 'advocate-pro-2') then 'PRO'
        when v_key in ('advocate-con-1', 'advocate-con-2') then 'CON'
        else null
      end;

      insert into public.participant_configs (
        run_id,
        participant_key,
        role,
        side,
        profile_name,
        personality_text,
        personality_source,
        personality_source_filename,
        model_id,
        prompt_version
      )
      -- Defense in depth: the Netlify Zod layer remains the
      -- user-facing authoritative normalizer, but the freeze RPC is the
      -- sole write path, so it trims free-text fields itself rather
      -- than persisting an obviously non-normalized (leading/trailing
      -- whitespace, or whitespace-only) value if ever called directly.
      -- btrim() is ordinary text trimming, unrelated to and not a
      -- substitute for the participant_configs_model_id_check /
      -- v_model_id C0-control-character validation above -- no chr(0)
      -- is introduced (PostgreSQL text cannot contain a NUL byte).
      values (
        v_new_run_id,
        v_key,
        v_role,
        v_side,
        nullif(btrim(v_participant ->> 'profile_name'), ''),
        btrim(v_participant ->> 'personality_text'),
        v_participant ->> 'personality_source',
        nullif(btrim(v_participant ->> 'personality_source_filename'), ''),
        btrim(v_participant ->> 'model_id'),
        'unassigned-pre-m7'
      );
    end loop;

    return query
      select tr.id, tr.case_id, tr.client_request_id, tr.execution_mode, tr.status, tr.created_at
      from public.tribunal_runs as tr
      where tr.id = v_new_run_id;
    return;
  end if;

  -- Did not win the insert: another request (this one, retried, or a
  -- concurrent one) already holds this client_request_id. Compare the
  -- stored fingerprint, atomically, against the one just computed.
  select tr.id, tr.case_id, tr.client_request_id, tr.request_fingerprint,
    tr.execution_mode, tr.status, tr.created_at
  into v_existing
  from public.tribunal_runs as tr
  where tr.client_request_id = p_client_request_id;

  if v_existing.request_fingerprint = p_request_fingerprint then
    return query
      select
        v_existing.id,
        v_existing.case_id,
        v_existing.client_request_id,
        v_existing.execution_mode,
        v_existing.status,
        v_existing.created_at;
    return;
  end if;

  raise exception 'idempotency_conflict' using errcode = 'P0001', hint = 'idempotency_conflict';
end;
$$;

-- EXECUTE privileges: revoked from every application-facing role except
-- service_role, in the same migration that creates the function (ADR
-- Decision 6/10). The controlled function owner (whichever role applies
-- this migration, typically an administrative/migration role) necessarily
-- has the underlying privileges SECURITY DEFINER needs -- that ownership
-- authority is never itself an application call path; no server or
-- browser code ever authenticates as the function owner.
revoke execute on function public.freeze_participant_configuration(uuid, text, text, text, jsonb)
from public, anon, authenticated;

grant execute on function public.freeze_participant_configuration(uuid, text, text, text, jsonb)
to service_role;
