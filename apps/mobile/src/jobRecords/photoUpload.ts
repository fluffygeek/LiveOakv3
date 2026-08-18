import { supabase } from "../supabase";

/**
 * Reads a local photo URI (the file:// URI expo-image-picker returns from the camera, see
 * SubmitJobScreen.tsx's pickPhoto) and uploads it to Supabase Storage through the
 * uploadJobRecordPhoto Edge Function (ticket #29) -- no direct client-to-bucket upload; the
 * Edge Function does the actual write using a service_role client
 * (supabase/functions/uploadJobRecordPhoto). Returns the durable storage-object path to store
 * on the Job Record's photoUrls, replacing the local device URI that used to be sent as-is
 * (see the removed comments this ticket updates in storage.ts and SubmitJobScreen.tsx).
 *
 * Reads the file via fetch + FileReader.readAsDataURL rather than adding expo-file-system:
 * both are already available in React Native/Expo -- fetch can read a local file:// URI as a
 * Blob, and React Native ships a FileReader/Blob polyfill -- so no new dependency is needed
 * for a one-photo-at-a-time base64 read.
 */
export async function uploadJobRecordPhoto(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  // FileReader.readAsDataURL always produces "data:<type>;base64,<payload>" with exactly one
  // comma separating the header from the payload -- slicing at the first comma is robust even
  // when <type> ends up empty (some RN fetch/Blob polyfills don't infer a type for local
  // file:// URIs), unlike a regex that requires a non-empty mime type in the header.
  const base64Data = dataUrl.slice(dataUrl.indexOf(",") + 1);
  // expo-image-picker's camera capture (SubmitJobScreen.tsx's pickPhoto) always produces
  // JPEG by default -- a safe fallback when blob.type comes back empty.
  const contentType = blob.type || "image/jpeg";

  const { data, error } = await supabase.functions.invoke<{ path: string }>(
    "uploadJobRecordPhoto",
    { body: { contentType, base64Data } },
  );
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("uploadJobRecordPhoto returned no data");
  }
  return data.path;
}

/**
 * Uploads every photo in order, sequentially -- simpler to reason about and to surface which
 * photo failed than Promise.all, and a Technician attaches at most a handful of photos per Job
 * Record (see @liveoakv3/shared's WORK_CODES minPhotos), so the lost parallelism isn't worth
 * the added complexity.
 */
export async function uploadJobRecordPhotos(uris: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const uri of uris) {
    paths.push(await uploadJobRecordPhoto(uri));
  }
  return paths;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read photo"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
