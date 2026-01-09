# Supabase: Manual Steps After Migration

1. **Create Storage Bucket**
   - In the Supabase Dashboard, create a storage bucket named `tracks`.
   - Set the option `public: false` (not public).
   - Optionally, set a file size limit (e.g., 10MB).

2. **Enable RLS for Storage**
   - Enable Row Level Security (RLS) for the `tracks` bucket.
   - Storage policies are defined in `init.sql` (at the end). You may need to create them manually in the Dashboard or SQL Editor.

3. **Check RLS for Tables**
   - Make sure RLS is enabled for all relevant tables (`tours`, `tour_members`, `tour_tracks`).
   - Policies are set by migration, but verify in the Dashboard.
   - **IMPORTANT FIX**: The `tours` table policy "select_own_or_public" needs to be updated to "select_own_or_public_or_shared" to allow shared tour members to see tours. Also, the `tour_members` policies need to be updated to use a helper function to avoid circular dependencies. Run the updated migration or manually apply the changes in the SQL Editor.

4. **Additional Notes**
   - Storage policies cannot always be set via migration, so check and create them manually if needed.
   - After changes: Test access with test users (read, write, delete).
   - If errors occur: Adjust policies in the Dashboard or drop/recreate them in the SQL Editor.

5. **URL Configuration**
   - Add your DEV-URL (eg. Localhost:3000) to the allowed urls-setings in the Supabase-Configs
---

**This file serves as a checklist for manual Supabase configuration after deployment.**
