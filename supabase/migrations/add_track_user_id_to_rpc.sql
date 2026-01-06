-- Migration: Add user_id to get_tracks_for_user RPC return columns
-- This allows the frontend to check track ownership for delete permissions

-- Drop and recreate the function with user_id included
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
