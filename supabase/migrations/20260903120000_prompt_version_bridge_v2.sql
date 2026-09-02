-- PRO/CON semantic correction (Issue #30) — Prompt-version bridge v2.
--
-- This migration is NOT applied to the real development database as part
-- of this implementation pass. It requires an independent static review
-- (source + migration) before it becomes historical remote state,
-- matching the discipline already established for every prior migration
-- in this repository.
--
-- Neither the already-applied Milestone 6 migration
-- (20260825214212_participant_configuration.sql) nor the already-applied
-- Milestone 7 prompt-version-bridge migration
-- (20260826173253_prompt_version_bridge.sql) is edited by this file --
-- this is a brand-new forward migration that CREATE OR REPLACEs the
-- freeze function with the identical signature, SECURITY DEFINER
-- property, search_path safety, schema qualification, idempotency
-- semantics, validation semantics, Shared-mode equality, privileges/
-- grants, and returned columns/behavior as both prior migrations. The
-- ONLY intended behavioral change: the hardcoded prompt_version literal
-- written per new row is now the CORRECTED role-specific version
-- (src/prompts/versions.ts's ADVOCATE_PROMPT_VERSION = 'advocate-v2',
-- JUDGE_PROMPT_VERSION = 'judge-v2') instead of the M7 values
-- ('advocate-v1' / 'judge-v1'). Every other line is copied verbatim from
-- the M7 prompt-version-bridge migration's function body.
--
-- advocate-v1 had the defendant-facing meaning of PRO/CON reversed by
-- accident (PRO argued for the charge/GUILTY, CON argued against it/
-- NOT_GUILTY); advocate-v2 corrects this to the locked product contract
-- (PRO = Defense, argues NOT_GUILTY; CON = Opposition/Prosecution,
-- argues GUILTY -- src/prompts/advocate-system.ts). judge-v1 never
-- referenced PRO/CON, but judge-v2 adds an explicit semantic legend so
-- the Judge's user-message PRO/CON labels are unambiguous
-- (src/prompts/judge-system.ts). Judge independence, the verdict
-- vocabulary (GUILTY/NOT_GUILTY), and the output schema are unchanged.
--
-- No historical participant_configs row is mutated by this migration --
-- CREATE OR REPLACE FUNCTION only replaces the function definition
-- itself, never touches existing table data. Every run frozen with
-- 'advocate-v1'/'judge-v1' (or the earlier 'unassigned-pre-m7'
-- placeholder) remains exactly as it was; a stale 'advocate-v1'/
-- 'judge-v1' READY run becomes execution-ineligible once the
-- application's EXPECTED_PROMPT_VERSION reflects this migration's new
-- current values (netlify/server/openrouter/preflight.ts) -- there is
-- no UPDATE statement anywhere in this file.
--
-- No caller-controlled prompt-version parameter is introduced: the
-- function signature (p_case_id, p_client_request_id,
-- p_request_fingerprint, p_execution_mode, p_participants) is unchanged,
-- and prompt_version continues to be derived internally from the same
-- v_role CASE-style derivation the function already uses for role/side --
-- never accepted as, or influenced by, a caller-supplied value. This
-- preserves docs/adr/0002-participant-configuration-freeze.md Decision 6's
-- non-caller-controlled property.
--
-- No BLOCKED_BUDGET/status behavior changes in this migration -- the
-- function still only ever writes 'READY' on a new run. Participant
-- role/side derivation (v_role/v_side) is byte-identical to both prior
-- migrations -- participant IDs and structural PRO/CON assignment are
-- explicitly unchanged by this correction.

create or replace function public.freeze_participant_configuration(
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
  -- Role-specific prompt_version, derived internally alongside
  -- v_role/v_side -- never a caller parameter.
  v_prompt_version text;
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

      -- PRO/CON semantic correction (Issue #30): the CORRECTED
      -- role-specific prompt_version, matching the exact literal values
      -- src/prompts/versions.ts exports (ADVOCATE_PROMPT_VERSION /
      -- JUDGE_PROMPT_VERSION, both bumped to v2 by this migration).
      -- Never a caller parameter -- derived from the same fixed v_role
      -- mapping above.
      v_prompt_version := case
        when v_role = 'ADVOCATE' then 'advocate-v2'
        else 'judge-v2'
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
        v_prompt_version
      );
    end loop;

    return query
      select tr.id, tr.case_id, tr.client_request_id, tr.execution_mode, tr.status, tr.created_at
      from public.tribunal_runs as tr
      where tr.id = v_new_run_id;
    return;
  end if;

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

-- Privileges are unchanged by this migration (CREATE OR REPLACE FUNCTION
-- preserves the existing grants), but re-asserted here explicitly and
-- idempotently so this migration's privilege state is self-contained and
-- does not silently depend on the prior migrations having already run
-- correctly.
revoke execute on function public.freeze_participant_configuration(uuid, text, text, text, jsonb)
from public, anon, authenticated;

grant execute on function public.freeze_participant_configuration(uuid, text, text, text, jsonb)
to service_role;
