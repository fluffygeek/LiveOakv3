import { invokeFunction } from "../supabase";

// Local device URIs (what expo-image-picker's camera capture returns, see
// SubmitJobScreen.tsx's pickPhoto) always use the file:// scheme. A Supabase Storage object
// path returned by uploadJobRecordPhoto (handler.ts) is a bare "<uuid>.<ext>" and never starts
// with this prefix, so it's a reliable way to tell "still needs uploading" apart from
// "already uploaded on a prior attempt" without any extra state (ticket #29 code review
// finding: offline-retry storage orphaning).
const LOCAL_FILE_URI_PREFIX = "file://";

/** True when `value` is a local device photo URI that still needs to be uploaded, as opposed
 * to a Supabase Storage object path already produced by a prior uploadJobRecordPhoto call. */
export function isLocalPhotoUri(value: string): boolean {
  return value.startsWith(LOCAL_FILE_URI_PREFIX);
}

// Conservative client-side guard on the raw (pre-base64) photo size. Supabase does not
// publicly document a request-body size limit for invoking an Edge Function -- the bucket's
// 50MiB file_size_limit (supabase/config.toml) only caps what Storage accepts once a request
// reaches it, not what the Edge Function's own request-handling layer in front of it will
// accept (see the doc comment on supabase/functions/uploadJobRecordPhoto/handler.ts's
// createHandler for the sources backing this). 6MiB raw -- about 8MiB once base64-encoded --
// is comfortably under every platform ceiling found in that research (including the ~4MiB
// figure anecdotally reported for a related but distinct limit) while still generous for a
// phone-camera JPEG at the quality SubmitJobScreen.tsx's ImagePicker captures with.
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** Thrown by uploadJobRecordPhoto when a photo is too large to safely attempt uploading.
 * Deliberately distinct from a network/server error and carries a `code` recognized by
 * errorClassification.ts's isLikelyOffline as non-retryable: a payload-too-large failure will
 * fail identically on every retry, so it must surface to the Technician immediately rather
 * than being silently queued for background sync like a connectivity failure would be. */
export class PhotoTooLargeError extends Error {
  readonly code = "functions/invalid-argument";

  constructor(byteLength: number) {
    super(
      `Photo is too large to upload (${(byteLength / (1024 * 1024)).toFixed(1)}MB, ` +
        `max ${(MAX_PHOTO_BYTES / (1024 * 1024)).toFixed(0)}MB). Retake it or lower the camera quality.`,
    );
    this.name = "PhotoTooLargeError";
  }
}

/** Best-effort inference of a photo's content type from its source URI's file extension, used
 * only as a fallback when blob.type comes back empty (see uploadJobRecordPhoto below) -- some
 * React Native fetch/Blob polyfills don't infer a type for local file:// reads. Covers the
 * extensions expo-image-picker's camera capture can plausibly produce; anything unrecognized
 * falls through to the "image/jpeg" default in uploadJobRecordPhoto, unchanged from before. */
function inferContentTypeFromUri(uri: string): string | null {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(uri);
  const extension = match?.[1]?.toLowerCase();
  switch (extension) {
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return null;
  }
}

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
  if (blob.size > MAX_PHOTO_BYTES) {
    throw new PhotoTooLargeError(blob.size);
  }
  const dataUrl = await blobToDataUrl(blob);
  // FileReader.readAsDataURL always produces "data:<type>;base64,<payload>" with exactly one
  // comma separating the header from the payload -- slicing at the first comma is robust even
  // when <type> ends up empty (some RN fetch/Blob polyfills don't infer a type for local
  // file:// URIs), unlike a regex that requires a non-empty mime type in the header.
  const base64Data = dataUrl.slice(dataUrl.indexOf(",") + 1);
  // blob.type is empty for some RN fetch/Blob polyfills reading a local file:// URI -- fall
  // back to inferring from the URI's own file extension (handles a HEIC/HEIF capture, which
  // some devices produce instead of JPEG) before finally defaulting to "image/jpeg", which
  // matches expo-image-picker's camera capture default.
  const contentType = blob.type || inferContentTypeFromUri(uri) || "image/jpeg";

  const { path } = await invokeFunction<{ path: string }>("uploadJobRecordPhoto", {
    contentType,
    base64Data,
  });
  return path;
}

/**
 * Uploads every photo in order, sequentially -- simpler to reason about and to surface which
 * photo failed than Promise.all, and a Technician attaches at most a handful of photos per Job
 * Record (see @liveoakv3/shared's WORK_CODES minPhotos), so the lost parallelism isn't worth
 * the added complexity.
 *
 * Entries that are already a Storage object path rather than a local file:// URI (see
 * isLocalPhotoUri above) are reused as-is instead of being re-uploaded -- this is what lets a
 * submission that already uploaded some or all of its photos on a prior attempt (e.g.
 * createJobRecord failed after the uploads succeeded, or an earlier offline retry got partway
 * through) skip re-uploading them under a fresh UUID and orphaning the previous objects
 * (ticket #29 code review finding). `onPhotoUploaded`, when given, is called with a snapshot
 * of the full photoUrls array after each individual photo finishes uploading -- not just once
 * the whole batch completes -- so a caller that persists queued-submission state (see
 * storage.ts's updateQueuedSubmissionPhotos, used by sync.ts) can save progress incrementally
 * and survive a crash or dropped connection partway through a retry.
 */
export async function uploadJobRecordPhotos(
  photoUrls: string[],
  onPhotoUploaded?: (photoUrls: string[]) => Promise<void> | void,
): Promise<string[]> {
  const result = [...photoUrls];
  for (let i = 0; i < result.length; i++) {
    if (!isLocalPhotoUri(result[i])) {
      continue; // already uploaded on a prior attempt -- nothing to do
    }
    result[i] = await uploadJobRecordPhoto(result[i]);
    await onPhotoUploaded?.([...result]);
  }
  return result;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read photo"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
