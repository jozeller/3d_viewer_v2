-- PUBLIC-SCHEMA: kompletter Reset + Neuaufbau
-- Achtung: Drops löschen Daten.

create extension if not exists pgcrypto;
create extension if not exists postgis;

-- Reihenfolge: zuerst abhängige Tabellen droppen
drop table if exists public.tour_members cascade;
drop table if exists public.tour_tracks cascade;
drop table if exists public.tours cascade;

-- tours (1 Owner)
create table public.tours (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,

  slug text not null unique,
  title text not null,
  description text null,

  visibility text not null default 'private'
    check (visibility in ('private','shared','public')),
  published boolean not null default false,

  start_time timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tours_owner_idx on public.tours(owner_id);
create index tours_created_at_idx on public.tours(created_at);

-- tour_members (Sharing; Owner nicht zwingend als Member-Row)
create table public.tour_members (
  tour_id uuid not null references public.tours(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  role text not null default 'viewer'
    check (role in ('viewer','editor')),

  created_at timestamptz not null default now(),

  primary key (tour_id, user_id)
);

create index tour_members_user_idx on public.tour_members(user_id);

-- tour_tracks (mehrere Tracks pro Tour)
create table public.tour_tracks (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,

  source text not null default 'gpx',

  -- GPX vor Upload in Geometrie umgewandelt (robust bei Segmenten)
  track geometry(MultiLineStringZ, 4326) not null,

  -- optionale Kennwerte
  track_points integer null,
  duration_s integer null,
  ascent_m double precision null,
  descent_m double precision null,
  min_ele_m double precision null,
  max_ele_m double precision null,

  -- optional: vereinfachte 2D-Geometrie für schnellen Viewer
  simplified geometry(MultiLineString, 4326) null,

  created_at timestamptz not null default now()
);

create index tour_tracks_tour_idx on public.tour_tracks(tour_id);
create index tour_tracks_user_idx on public.tour_tracks(user_id);

create index tour_tracks_track_gix
  on public.tour_tracks
  using gist (track);

create index tour_tracks_simplified_gix
  on public.tour_tracks
  using gist (simplified);

-- updated_at Trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_tours_updated_at
before update on public.tours
for each row
execute function public.set_updated_at();
