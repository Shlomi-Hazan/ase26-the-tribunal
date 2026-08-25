-- The original cases_source_filename_check constraint (from
-- 20260825000000_create_cases.sql) included
-- `position(chr(0) in source_filename) = 0` to defensively reject an
-- embedded NUL byte. PostgreSQL's text type cannot represent a NUL byte at
-- all (it is internally NUL-terminated), so `chr(0)` cannot be constructed
-- as a text value and this expression fails with "null character not
-- permitted" (SQLSTATE 54000) whenever it is evaluated -- which blocked
-- every insert into public.cases, regardless of payload. The check is also
-- redundant: Postgres already structurally guarantees no text column can
-- ever contain a NUL byte, so removing it changes no real validation
-- behaviour. This migration replaces only that constraint; the original
-- migration file is left untouched because it has already been applied.
alter table public.cases
  drop constraint cases_source_filename_check;

alter table public.cases
  add constraint cases_source_filename_check check (
    source_filename is null
    or (
      char_length(source_filename) between 1 and 255
      and source_filename !~ '[/\\]'
    )
  );
