-- Migration: Add track download support with original file storage
-- Run this migration to add the original_file_path column and update RPCs

-- 1. Add column for original file path (stored in Supabase Storage bucket 'tracks')
ALTER TABLE public.tour_tracks 
ADD COLUMN IF NOT EXISTS original_file_path text null;

-- 2. Create storage bucket for track files
-- This needs to be run separately or via Supabase Dashboard
-- INSERT INTO storage.buckets (id, name, public, file_size_limit)
-- VALUES ('tracks', 'tracks', false, 10485760)
-- ON CONFLICT (id) DO NOTHING;

-- 3. Storage policies for the 'tracks' bucket
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

-- 3. Update insert_tour_track RPC to accept original_file_path
DROP FUNCTION IF EXISTS public.insert_tour_track(uuid, jsonb, json, text) CASCADE;

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

-- 4. Update get_tracks_for_user to return original_file_path
DROP FUNCTION IF EXISTS public.get_tracks_for_user() CASCADE;

CREATE OR REPLACE FUNCTION public.get_tracks_for_user()
RETURNS TABLE(id uuid, tour_id uuid, name text, geo json, original_file_path text, created_at timestamptz) AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.tour_id, t.name, ST_AsGeoJSON(t.track)::json, t.original_file_path, t.created_at
  FROM public.tour_tracks t
  WHERE (
    t.user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tours tr WHERE tr.id = t.tour_id AND tr.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.tour_members m WHERE m.tour_id = t.tour_id AND m.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.tours tr WHERE tr.id = t.tour_id AND tr.visibility = 'public')
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. RPC to generate GPX from stored geometry (fallback when no original file)
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

-- 6. RPC to get track statistics for intelligent camera positioning
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
