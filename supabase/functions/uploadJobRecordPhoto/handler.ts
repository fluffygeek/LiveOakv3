import type { Role } from "@liveoakv3/shared";
import { ForbiddenError, InvalidArgumentError } from "../../../functions/src/access/errors.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";
import type { PhotoStorageRepository } from "./photoStorageRepository.ts";

/** Allow-listed content types -- mirrors the bucket's `allowed_mime_types` constraint
 * (supabase/migrations/20260817000000_job_record_photos_bucket.sql) so a rejected upload
 * fails fast with a clear 400 here rather than a less legible Storage-layer error.
 *
 * A `Map` rather than a plain object: a plain-object lookup via the `in` operator (or a
 * bracket-index read) also matches inherited `Object.prototype` property names --
 * `"constructor" in {"image/jpeg":"jpg"}` is `true`, and `{...}["constructor"]` returns the
 * `Object` constructor function itself. A request with `contentType: "constructor"` (or
 * `"toString"`, `"hasOwnProperty"`, etc.) would then slip past the allowlist check and produce
 * a garbage extension/content-type forwarded to Storage. `Map` has no prototype chain of
 * string-keyed properties to accidentally match, so `.has`/`.get` need no extra guarding --
 * the same allowlist-safety goal @liveoakv3/shared's `isRole()` (packages/shared/src/roles.ts)
 * reaches via `array.includes()`. */
const EXTENSION_BY_CONTENT_TYPE = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

export interface UploadJobRecordPhotoInput {
  contentType: string;
  base64Data: string;
}

/** Validates untyped request-body input at the boundary before it reaches the storage upload,
 * the same role validation.ts's parseCreateJobRecordInput plays for createJobRecord. */
function parseUploadJobRecordPhotoInput(data: unknown): UploadJobRecordPhotoInput {
  if (typeof data !== "object" || data === null) {
    throw new InvalidArgumentError("request body must be an object");
  }
  const record = data as Record<string, unknown>;
  const contentType = record.contentType;
  if (typeof contentType !== "string" || !EXTENSION_BY_CONTENT_TYPE.has(contentType)) {
    throw new InvalidArgumentError(
      `contentType must be one of: ${[...EXTENSION_BY_CONTENT_TYPE.keys()].join(", ")}`,
    );
  }
  const base64Data = record.base64Data;
  if (typeof base64Data !== "string" || base64Data.length === 0) {
    throw new InvalidArgumentError("base64Data must be a non-empty base64-encoded string");
  }
  return { contentType, base64Data };
}

/** atob/btoa are the same Web Platform APIs the mobile client encodes with (see
 * apps/mobile/src/jobRecords/photoUpload.ts) -- no extra Deno std-lib dependency needed for a
 * plain base64-to-bytes round trip. */
function decodeBase64(base64Data: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64Data);
  } catch {
    throw new InvalidArgumentError("base64Data is not valid base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Same gate createJobRecordService.ts's requireTechnician enforces on submission -- applied
 * here too since a photo is uploaded before the Job Record it belongs to exists, so there's
 * nowhere else to enforce "only a Technician submits Job Record photos" for this call. */
function requireTechnician(callerRoles: Role[]): void {
  if (!callerRoles.includes("technician")) {
    throw new ForbiddenError("Only a Technician can upload a Job Record photo");
  }
}

/**
 * Lets a Technician upload a single Job Record photo to Supabase Storage from the mobile app
 * (ticket #29) -- genuinely new functionality; a repo-wide search found no prior Supabase
 * Storage usage anywhere, and photo upload was never implemented against Firebase Storage
 * either. Mirrors createJobRecord/handler.ts's shape: production wiring lives in index.ts,
 * testable logic lives here, and this uses defineResolvedAccessHandler (not the plain
 * defineEdgeHandler) because requireTechnician needs the caller's resolved roles.
 *
 * The request body is JSON with a base64-encoded payload rather than multipart/form-data --
 * defineEdgeHandler's transport (../_shared/callableHandler.ts) already parses a JSON body
 * once via `config.parse`, so reusing it here keeps this function on the same
 * request-handling path as every other Edge Function instead of hand-rolling multipart
 * parsing for one endpoint. Base64's ~33% size overhead is an acceptable tradeoff for typical
 * compressed phone-camera photos (low single-digit MB at the quality
 * apps/mobile/src/jobRecords/SubmitJobScreen.tsx's ImagePicker captures with).
 *
 * NOTE: the bucket's 50MiB `file_size_limit` (supabase/config.toml) is NOT the binding
 * constraint on this request body -- it only caps what Storage itself accepts once a request
 * reaches it. Supabase Edge Functions run on Supabase's own request-handling layer in front of
 * that, and its request-body ceiling is (as of this writing) not publicly documented at all
 * -- see the still-open supabase/supabase#28053 asking Supabase to document it, and
 * supabase/cli#5076 reporting an undocumented ~4MiB ceiling encountered in practice (for
 * function *bundle* deploys, a related but distinct limit from a per-request payload). Given
 * that uncertainty, the actual guard against an oversized request lives client-side, in
 * apps/mobile/src/jobRecords/photoUpload.ts's pre-upload size check, well under any plausible
 * platform ceiling -- not here, and not assumed to be the bucket's 50MiB.
 *
 * Returns the object's storage path -- not a public URL, since the bucket denies direct
 * anon/authenticated access and so has no public URL -- as the durable reference the mobile
 * client then includes in the Job Record's photoUrls on createJobRecord (see
 * apps/mobile/src/jobRecords/api.ts). The object key is an opaque, freshly generated UUID
 * rather than derived from any Technician-typed input, so there's no user-controlled text to
 * sanitize into a storage path.
 */
export function createHandler(
  userRepo: UserRepository,
  photoStorageRepo: PhotoStorageRepository,
  verifyCaller?: VerifyCaller,
  generateId: () => string = () => crypto.randomUUID(),
): (req: Request) => Promise<Response> {
  return defineResolvedAccessHandler<UploadJobRecordPhotoInput>(userRepo, {
    verifyCaller,
    parse: parseUploadJobRecordPhotoInput,
    handle: async (caller, input) => {
      requireTechnician(caller.roles);
      const bytes = decodeBase64(input.base64Data);
      // parseUploadJobRecordPhotoInput already confirmed input.contentType is a key of
      // EXTENSION_BY_CONTENT_TYPE, so this get() is guaranteed to hit.
      const extension = EXTENSION_BY_CONTENT_TYPE.get(input.contentType) as string;
      const path = `${generateId()}.${extension}`;
      await photoStorageRepo.upload(path, bytes, input.contentType);
      return { path };
    },
  });
}
