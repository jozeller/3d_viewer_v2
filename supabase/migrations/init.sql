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

  -- original file stored in Supabase Storage (path in bucket 'tracks')
  original_file_path text null,

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
  p_track_name text DEFAULT NULL,
  p_original_file_path text DEFAULT NULL
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
    tour_id, user_id, source, name, track, track_points, simplified, original_file_path, created_at
  ) VALUES (
    p_tour_id,
    auth.uid(),
    'gpx',
    p_track_name,
    geom_ml,
    ST_NPoints(geom_ml),
    ST_Simplify(ST_Force2D(geom_ml), 0.0001),
    p_original_file_path,
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
RETURNS TABLE(id uuid, tour_id uuid, name text, geo json, original_file_path text, created_at timestamptz, user_id uuid) AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.tour_id, t.name, ST_AsGeoJSON(t.track)::json, t.original_file_path, t.created_at, t.user_id
  FROM public.tour_tracks t
  WHERE (
    t.user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tours tr WHERE tr.id = t.tour_id AND tr.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.tour_members m WHERE m.tour_id = t.tour_id AND m.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.tours tr WHERE tr.id = t.tour_id AND tr.visibility = 'public')
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- RPC: get tour members with email for a tour
DROP FUNCTION IF EXISTS public.get_tour_members(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.get_tour_members(p_tour_id uuid)
RETURNS TABLE(user_id uuid, email text, role text, created_at timestamptz) AS $$
BEGIN
  -- Only allow owner or members to see member list
  IF NOT EXISTS (
    SELECT 1 FROM public.tours t WHERE t.id = p_tour_id AND t.owner_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.tour_members m WHERE m.tour_id = p_tour_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT tm.user_id, u.email::text, tm.role, tm.created_at
  FROM public.tour_members tm
  JOIN auth.users u ON u.id = tm.user_id
  WHERE tm.tour_id = p_tour_id
  ORDER BY tm.created_at ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- RPC: remove self from tour (for members, not owner)
DROP FUNCTION IF EXISTS public.leave_tour(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.leave_tour(p_tour_id uuid)
RETURNS boolean AS $$
BEGIN
  -- Check that user is a member (not owner)
  IF NOT EXISTS (
    SELECT 1 FROM public.tour_members WHERE tour_id = p_tour_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You are not a member of this tour';
  END IF;

  DELETE FROM public.tour_members WHERE tour_id = p_tour_id AND user_id = auth.uid();
  RETURN true;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

-- RPC: get tour member count
DROP FUNCTION IF EXISTS public.get_tour_member_count(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.get_tour_member_count(p_tour_id uuid)
RETURNS integer AS $$
BEGIN
  RETURN (SELECT COUNT(*)::integer FROM public.tour_members WHERE tour_id = p_tour_id);
END;
$$ LANGUAGE plpgsql STABLE;

-- RPC: generate GPX from stored geometry (fallback when no original file)
DROP FUNCTION IF EXISTS public.get_track_as_gpx(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.get_track_as_gpx(p_track_id uuid)
RETURNS text AS $$
DECLARE
  track_rec RECORD;
  gpx_content text;
BEGIN
  -- Check access rights
  SELECT t.id, t.name, t.track, t.tour_id
  INTO track_rec
  FROM public.tour_tracks t
  WHERE t.id = p_track_id
    AND (
      t.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.tours tr WHERE tr.id = t.tour_id AND tr.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.tour_members m WHERE m.tour_id = t.tour_id AND m.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.tours tr WHERE tr.id = t.tour_id AND tr.visibility = 'public')
    );

  IF track_rec IS NULL THEN
    RAISE EXCEPTION 'Track not found or access denied';
  END IF;

  -- Generate GPX XML
  gpx_content := '<?xml version="1.0" encoding="UTF-8"?>' || chr(10) ||
    '<gpx version="1.1" creator="3D Viewer" xmlns="http://www.topografix.com/GPX/1/1">' || chr(10) ||
    '  <metadata>' || chr(10) ||
    '    <name>' || COALESCE(track_rec.name, 'Track') || '</name>' || chr(10) ||
    '    <time>' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '</time>' || chr(10) ||
    '  </metadata>' || chr(10) ||
    '  <trk>' || chr(10) ||
    '    <name>' || COALESCE(track_rec.name, 'Track') || '</name>' || chr(10);

  -- Convert each linestring in the multilinestring to a trkseg
  gpx_content := gpx_content || (
    SELECT string_agg(
      '    <trkseg>' || chr(10) ||
      (
        SELECT string_agg(
          '      <trkpt lat="' || ST_Y(pt) || '" lon="' || ST_X(pt) || '">' ||
          CASE WHEN ST_Z(pt) IS NOT NULL AND ST_Z(pt) != 0 THEN '<ele>' || ST_Z(pt) || '</ele>' ELSE '' END ||
          '</trkpt>',
          chr(10)
        )
        FROM ST_DumpPoints(geom) AS dp(path, pt)
        ORDER BY dp.path
      ) || chr(10) ||
      '    </trkseg>',
      chr(10)
    )
    FROM ST_Dump(track_rec.track) AS d(path, geom)
  );

  gpx_content := gpx_content || chr(10) ||
    '  </trk>' || chr(10) ||
    '</gpx>';

  RETURN gpx_content;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =========================
-- RPC to get track statistics for intelligent camera positioning
-- =========================
DROP FUNCTION IF EXISTS public.get_track_view_stats(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.get_track_view_stats(p_track_id uuid)
RETURNS json AS $$
DECLARE
  track_rec RECORD;
  first_line geometry;
  start_pt geometry;
  end_pt geometry;
  center_pt geometry;
  azimuth_rad float;
  result json;
BEGIN
  -- Check access rights and get track
  SELECT t.id, t.name, t.track, t.tour_id
  INTO track_rec
  FROM public.tour_tracks t
  WHERE t.id = p_track_id
    AND (
      t.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.tours tr WHERE tr.id = t.tour_id AND tr.owner_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.tour_members m WHERE m.tour_id = t.tour_id AND m.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.tours tr WHERE tr.id = t.tour_id AND tr.visibility = 'public')
    );

  IF track_rec IS NULL THEN
    RAISE EXCEPTION 'Track not found or access denied';
  END IF;

  -- Get first linestring from multilinestring
  first_line := ST_GeometryN(track_rec.track, 1);
  
  -- Get start and end points
  start_pt := ST_StartPoint(first_line);
  end_pt := ST_EndPoint(first_line);
  
  -- Get centroid of entire track
  center_pt := ST_Centroid(track_rec.track);
  
  -- Calculate azimuth (direction from start to end) in degrees
  azimuth_rad := ST_Azimuth(start_pt, end_pt);

  -- Build result JSON
  result := json_build_object(
    'center_lon', ST_X(center_pt),
    'center_lat', ST_Y(center_pt),
    'start_lon', ST_X(start_pt),
    'start_lat', ST_Y(start_pt),
    'start_ele', COALESCE(ST_Z(start_pt), 0),
    'end_lon', ST_X(end_pt),
    'end_lat', ST_Y(end_pt),
    'end_ele', COALESCE(ST_Z(end_pt), 0),
    'azimuth_deg', degrees(COALESCE(azimuth_rad, 0)),
    'length_m', ST_Length(track_rec.track::geography),
    'bbox', json_build_object(
      'min_lon', ST_XMin(track_rec.track),
      'min_lat', ST_YMin(track_rec.track),
      'max_lon', ST_XMax(track_rec.track),
      'max_lat', ST_YMax(track_rec.track),
      'min_ele', ST_ZMin(track_rec.track),
      'max_ele', ST_ZMax(track_rec.track)
    ),
    'elevation_gain', GREATEST(0, COALESCE(ST_Z(end_pt), 0) - COALESCE(ST_Z(start_pt), 0))
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =========================
-- Storage bucket for track files
-- =========================
-- Note: Bucket creation must be done via Supabase Dashboard or API
-- Bucket name: 'tracks', public: false, file_size_limit: 10MB

-- Storage policies for the 'tracks' bucket
-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload to own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tracks' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow users to read files they have access to (via tour membership)
CREATE POLICY "Users can read accessible tracks" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'tracks'
    AND (
      -- Own files
      (storage.foldername(name))[1] = auth.uid()::text
      -- Or files for tours they own or are member of
      OR EXISTS (
        SELECT 1 FROM public.tour_tracks tt
        JOIN public.tours t ON t.id = tt.tour_id
        WHERE tt.original_file_path = name
        AND (
          t.owner_id = auth.uid()
          OR tt.user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.tour_members tm WHERE tm.tour_id = t.id AND tm.user_id = auth.uid())
          OR t.visibility = 'public'
        )
      )
    )
  );

-- Allow users to delete their own files
CREATE POLICY "Users can delete own files" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'tracks'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
