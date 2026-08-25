create extension if not exists pgcrypto;

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  defendant text not null check (
    char_length(btrim(defendant)) between 1 and 200
  ),
  act text not null check (
    char_length(btrim(act)) between 1 and 6000
  ),
  exact_question text not null check (
    char_length(btrim(exact_question)) between 1 and 1000
  ),
  source_type text not null check (
    source_type in (
      'MANUAL',
      'CHARGE_SHEET_FILE',
      'TRIBUNAL_PACKAGE_FILE'
    )
  ),
  source_filename text check (
    source_filename is null
    or (
      char_length(source_filename) between 1 and 255
      and source_filename !~ '[/\\]'
      and position(chr(0) in source_filename) = 0
    )
  ),
  created_at timestamptz not null default now()
);

alter table public.cases enable row level security;
