/**
 * Pipeline Step 5 — UPLOAD
 *
 * Uploads the generated audio to Supabase Storage.
 * Path convention: {userId}/{episodeId}.mp3
 * Bucket: "podcasts"
 */

import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "podcasts";

export interface StorageStepParams {
  audio: ArrayBuffer;
  userId: string;
  episodeId: string;
}

/**
 * Upload audio to Supabase Storage and return the storage path.
 *
 * Uses the admin client (service role) to bypass RLS on the storage bucket.
 * The file is stored as an MP3 at `{userId}/{episodeId}.mp3`.
 */
export async function storageStep(
  params: StorageStepParams
): Promise<string> {
  const { audio, userId, episodeId } = params;

  if (audio.byteLength === 0) {
    throw new Error("Cannot upload: audio buffer is empty");
  }

  const storagePath = `${userId}/${episodeId}.mp3`;
  const supabase = createAdminClient();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, audio, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return storagePath;
}
