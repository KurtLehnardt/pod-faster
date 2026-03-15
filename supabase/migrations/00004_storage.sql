-- 00004_storage.sql
-- Storage bucket and RLS policies for podcast audio files.
-- Path pattern: {user_id}/{episode_id}.mp3

-- Create the podcasts bucket (private — requires signed URLs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'podcasts',
  'podcasts',
  false,
  52428800,  -- 50 MB
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav']
);

-- Storage RLS: users can read their own audio files
CREATE POLICY "Users can read their own podcast files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'podcasts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage RLS: users can upload to their own folder
CREATE POLICY "Users can upload their own podcast files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'podcasts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage RLS: users can update their own files
CREATE POLICY "Users can update their own podcast files"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'podcasts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'podcasts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage RLS: users can delete their own files
CREATE POLICY "Users can delete their own podcast files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'podcasts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
