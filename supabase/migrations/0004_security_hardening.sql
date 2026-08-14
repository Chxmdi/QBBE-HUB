-- Address security linter findings: pin function search_path and move
-- pg_trgm out of the public schema (Supabase lints 0011 / 0014).

alter function public.set_updated_at() set search_path = public;

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
