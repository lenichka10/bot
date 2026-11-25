-- =====================================================================
-- Station Energie · Supabase setup
-- Paste this whole file into Supabase → SQL Editor → "Run".
-- You can run it again later: it removes and rebuilds everything
-- (all answers are deleted, the PIN is set back to the value below).
-- =====================================================================

-- PIN for the Leitung view: 1234. To change it, edit the '1234' near the
-- end of this file (section "Start data") before you run it.
-- (Convenience lock only. There is no personal data in this app.)

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

drop table if exists public.group_claims cascade;
drop table if exists public.groups cascade;
drop table if exists public.rounds cascade;
drop table if exists public.app_settings cascade;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- One row per workshop round. Exactly one round is active at a time.
create table public.rounds (
  id          uuid primary key default gen_random_uuid(),
  profession  text check (profession in ('automatiker', 'polymech', 'konstrukteur')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index rounds_one_active on public.rounds (active) where active;

-- One row per group in a round. Public: the dashboard reads it.
create table public.groups (
  round_id    uuid not null references public.rounds (id) on delete cascade,
  group_no    int  not null check (group_no between 1 and 6),
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (round_id, group_no)          -- makes claiming atomic
);

-- Secret part of a claim: which device owns which group.
-- Nobody can read this table from the browser. Only the functions below use it.
create table public.group_claims (
  round_id     uuid not null,
  group_no     int  not null,
  device_token uuid not null,
  primary key (round_id, group_no),
  foreign key (round_id, group_no) references public.groups (round_id, group_no) on delete cascade
);

-- Settings (only the hashed PIN). Not readable from the browser.
create table public.app_settings (
  id        int primary key default 1 check (id = 1),
  pin_hash  text not null
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.rounds       enable row level security;
alter table public.groups       enable row level security;
alter table public.group_claims enable row level security;
alter table public.app_settings enable row level security;

-- Everyone may read rounds and group answers (no personal data inside).
create policy rounds_read on public.rounds for select to anon, authenticated using (true);
create policy groups_read on public.groups for select to anon, authenticated using (true);
-- No insert/update/delete policies: all writes go through the functions below.
-- group_claims and app_settings have no policies at all → no direct access.

revoke all on public.group_claims, public.app_settings from anon, authenticated;
revoke insert, update, delete, truncate on public.rounds, public.groups from anon, authenticated;
grant select on public.rounds, public.groups to anon, authenticated;

-- ---------------------------------------------------------------------
-- Functions for the groups (no PIN)
-- ---------------------------------------------------------------------

-- Claim a group in the active round. Atomic: if two devices try at the
-- same moment, the primary key lets only one of them win.
create or replace function public.claim_group(p_group int, p_token uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_round uuid;
  v_rows  int;
begin
  if p_group is null or p_group < 1 or p_group > 6 or p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select id into v_round from rounds where active;
  if v_round is null then
    return jsonb_build_object('ok', false, 'reason', 'no_round');
  end if;

  insert into groups (round_id, group_no) values (v_round, p_group)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'reason', 'taken', 'round_id', v_round);
  end if;

  insert into group_claims (round_id, group_no, device_token) values (v_round, p_group, p_token);
  return jsonb_build_object('ok', true, 'round_id', v_round);
end;
$$;

-- Save a group's answers. Only the device with the right token may save,
-- and only in the active round.
-- Returns 'ok', or 'gone' (round is over or the group was released).
create or replace function public.save_state(p_round uuid, p_group int, p_token uuid, p_state jsonb)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if p_state is null or pg_column_size(p_state) > 20000 then
    return 'invalid';
  end if;
  update groups g
     set state = p_state, updated_at = now()
    from group_claims c, rounds r
   where g.round_id = p_round and g.group_no = p_group
     and c.round_id = g.round_id and c.group_no = g.group_no and c.device_token = p_token
     and r.id = g.round_id and r.active;
  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'ok' else 'gone' end;
end;
$$;

-- Does this device still own its group? (Used after a reload.)
create or replace function public.check_claim(p_round uuid, p_group int, p_token uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from group_claims c join rounds r on r.id = c.round_id
     where c.round_id = p_round and c.group_no = p_group and c.device_token = p_token and r.active
  );
$$;

-- ---------------------------------------------------------------------
-- Functions for the Leitung (PIN is checked on the server)
-- ---------------------------------------------------------------------

create or replace function public.leitung_pin_ok(p_pin text)
returns boolean
language sql security definer stable
set search_path = public, extensions
as $$
  select exists (select 1 from app_settings where pin_hash = crypt(coalesce(p_pin, ''), pin_hash));
$$;

create or replace function public.leitung_check(p_pin text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if not leitung_pin_ok(p_pin) then
    perform pg_sleep(1);  -- slows down guessing
    return false;
  end if;
  return true;
end;
$$;

-- Start a new round: delete all old rounds and answers, keep the profession.
create or replace function public.leitung_new_round(p_pin text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_prof text;
  v_new  uuid;
begin
  if not leitung_pin_ok(p_pin) then raise exception 'PIN falsch' using errcode = '28000'; end if;
  select profession into v_prof from rounds where active;
  update rounds set active = false where active;
  insert into rounds (profession, active) values (v_prof, true) returning id into v_new;
  delete from rounds where id <> v_new;   -- cascades to groups and claims
  return v_new;
end;
$$;

create or replace function public.leitung_set_profession(p_pin text, p_profession text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not leitung_pin_ok(p_pin) then raise exception 'PIN falsch' using errcode = '28000'; end if;
  update rounds set profession = p_profession where active;
end;
$$;

-- Release a group: its answers are deleted and the group can be chosen again.
create or replace function public.leitung_release(p_pin text, p_group int)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not leitung_pin_ok(p_pin) then raise exception 'PIN falsch' using errcode = '28000'; end if;
  delete from groups g using rounds r
   where g.round_id = r.id and r.active and g.group_no = p_group;
end;
$$;

-- Only these functions may be called from the browser.
revoke all on function public.leitung_pin_ok(text) from public, anon, authenticated;
grant execute on function public.claim_group(int, uuid)                to anon, authenticated;
grant execute on function public.save_state(uuid, int, uuid, jsonb)    to anon, authenticated;
grant execute on function public.check_claim(uuid, int, uuid)          to anon, authenticated;
grant execute on function public.leitung_check(text)                   to anon, authenticated;
grant execute on function public.leitung_new_round(text)               to anon, authenticated;
grant execute on function public.leitung_set_profession(text, text)    to anon, authenticated;
grant execute on function public.leitung_release(text, int)            to anon, authenticated;

-- ---------------------------------------------------------------------
-- Start data
-- ---------------------------------------------------------------------
insert into public.app_settings (id, pin_hash) values (1, extensions.crypt('1234', extensions.gen_salt('bf')));
insert into public.rounds (profession, active) values (null, true);

-- ---------------------------------------------------------------------
-- Realtime: send changes of these two tables live to the browsers
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.rounds, public.groups;
