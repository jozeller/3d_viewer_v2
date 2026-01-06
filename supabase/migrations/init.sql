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
  name text null,  -- user-defined track name (editable)

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

-- =========================
-- RLS + RPC for GPX / tour_tracks
-- =========================

-- Enable row level security for tour_tracks
ALTER TABLE public.tour_tracks ENABLE ROW LEVEL SECURITY;

-- Allow inserts only for authenticated users; function will set user_id = auth.uid()
CREATE POLICY "insert_own" ON public.tour_tracks
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Select: allow creator, tour owner, tour members, or when tour is public
CREATE POLICY "select_owner_member_public" ON public.tour_tracks
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tours t WHERE t.id = public.tour_tracks.tour_id AND (t.owner_id = auth.uid() OR t.visibility = 'public'))
    OR EXISTS (SELECT 1 FROM public.tour_members m WHERE m.tour_id = public.tour_tracks.tour_id AND m.user_id = auth.uid())
  );

-- Update: allow creator, tour owner or members
CREATE POLICY "update_owner_or_creator" ON public.tour_tracks
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tours t WHERE t.id = public.tour_tracks.tour_id AND t.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.tour_members m WHERE m.tour_id = public.tour_tracks.tour_id AND m.user_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tours t WHERE t.id = public.tour_tracks.tour_id AND t.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.tour_members m WHERE m.tour_id = public.tour_tracks.tour_id AND m.user_id = auth.uid())
  );

-- Delete: allow creator, tour owner or members
CREATE POLICY "delete_owner_or_creator" ON public.tour_tracks
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tours t WHERE t.id = public.tour_tracks.tour_id AND t.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.tour_members m WHERE m.tour_id = public.tour_tracks.tour_id AND m.user_id = auth.uid())
  );

-- RPC to insert a GPX/GeoJSON track for the calling user
CREATE OR REPLACE FUNCTION public.insert_tour_track(
  p_tour_id uuid,
  p_props jsonb,
  p_geojson json,
  p_track_name text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  geom geometry;
  geom_ml geometry(MultiLineStringZ,4326);
  new_id uuid;
  geojson_jsonb jsonb;
BEGIN
  -- cast json to jsonb for manipulation
  geojson_jsonb := p_geojson::jsonb;
  
  -- iterate through features and collect all LineStrings
  -- (handle both individual LineStrings and those nested in FeatureCollection)
  IF p_geojson::text LIKE '%"type":"FeatureCollection"%' THEN
    -- extract all geometries from features and combine
    geom := ST_GeomFromGeoJSON(jsonb_build_object(
      'type', 'GeometryCollection',
      'geometries', (
        SELECT jsonb_agg(f->'geometry')
        FROM jsonb_array_elements(geojson_jsonb->'features') f
        WHERE f->'geometry' IS NOT NULL
      )
    )::text);
  ELSE
    -- single geometry or feature
    IF p_geojson::text LIKE '%"type":"Feature"%' THEN
      geom := ST_GeomFromGeoJSON((geojson_jsonb->'geometry')::text);
    ELSE
      geom := ST_GeomFromGeoJSON(p_geojson::text);
    END IF;
  END IF;

  -- convert to 3D and extract only LineStrings
  geom := ST_Force3D(geom);
  geom_ml := ST_SetSRID(
    ST_Multi(
      COALESCE(ST_CollectionExtract(geom, 2), ST_GeomFromText('MULTILINESTRING EMPTY', 4326))
    ), 4326
  );

  IF geom_ml IS NULL OR ST_IsEmpty(geom_ml) THEN
    RAISE EXCEPTION 'No LineString geometry found in provided GeoJSON';
  END IF;

  INSERT INTO public.tour_tracks (
    tour_id, user_id, source, name, track, track_points, simplified, created_at
  ) VALUES (
    p_tour_id,
    auth.uid(),
    'gpx',
    p_track_name,
    geom_ml,
    ST_NPoints(geom_ml),
    ST_Simplify(ST_Force2D(geom_ml), 0.0001),
    now()
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- RPC: share tour with email (adds tour_members) - raises exception if email not found
CREATE OR REPLACE FUNCTION public.share_tour_with_email(p_tour_id uuid, p_email text)
RETURNS boolean AS $$
DECLARE
  u uuid;
BEGIN
  SELECT id INTO u FROM auth.users WHERE email = p_email LIMIT 1;
  IF u IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', p_email;
  END IF;

  -- Prevent duplicates
  IF NOT EXISTS (SELECT 1 FROM public.tour_members WHERE tour_id = p_tour_id AND user_id = u) THEN
    INSERT INTO public.tour_members (tour_id, user_id, role, created_at) VALUES (p_tour_id, u, 'viewer', now());
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: get tracks (as GeoJSON) accessible to calling user
DROP FUNCTION IF EXISTS public.get_tracks_for_user() CASCADE;

CREATE OR REPLACE FUNCTION public.get_tracks_for_user()
RETURNS TABLE(id uuid, tour_id uuid, name text, geo json, created_at timestamptz) AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.tour_id, t.name, ST_AsGeoJSON(t.track)::json, t.created_at
  FROM public.tour_tracks t
  WHERE (
    t.user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tours tr WHERE tr.id = t.tour_id AND tr.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.tour_members m WHERE m.tour_id = t.tour_id AND m.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.tours tr WHERE tr.id = t.tour_id AND tr.visibility = 'public')
  );
END;
$$ LANGUAGE plpgsql STABLE;

