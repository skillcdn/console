import type { Context } from "hono";
import type { AppEnv } from "./request-context.js";

// A picture the console keeps and shows in place: a project's mark, what an agent's tools
// returned, what a supervisor sent with a tell. What it is is read off its bytes, never off what
// whoever sent it said, and it is answered under that kind with a policy that runs nothing.

export type KeptPictureType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** What kind of picture the bytes are, by how they begin: a PNG, a JPEG, a GIF or a WebP; or nothing. */
export function imageTypeOf(bytes: Uint8Array): KeptPictureType | undefined {
  const at = (index: number, ...expected: number[]) =>
    expected.every((byte, offset) => bytes[index + offset] === byte);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (at(0, 0xff, 0xd8, 0xff)) {
    return "image/jpeg";
  }
  if (
    at(0, 0x47, 0x49, 0x46, 0x38) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return "image/webp";
  }
  return undefined;
}

/** The bytes of a picture, shown in place under its kind: never sniffed, never run, and read by the console's own pages alone. */
export function pictureResponse(
  c: Context<AppEnv>,
  contentType: KeptPictureType,
  bytes: Uint8Array,
): Response {
  c.header("content-type", contentType);
  c.header("content-length", String(bytes.byteLength));
  c.header("content-disposition", "inline");
  c.header("x-content-type-options", "nosniff");
  c.header("content-security-policy", "default-src 'none'; sandbox");
  c.header("cross-origin-resource-policy", "same-origin");
  // A copy of its own: what the driver hands over may be a view of a larger buffer.
  return c.body(new Uint8Array(bytes).buffer);
}

/**
 * `filename="..."; filename*=UTF-8''...`: the name for every browser, in what every one of them
 * reads, and the exact one for those that read the second form.
 */
export function filenameParameters(name: string): string {
  const plain = name.replaceAll(/[^\x20-\x7e]/g, "_").replaceAll(/["\\]/g, "_");
  const exact = encodeURIComponent(name).replaceAll(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `filename="${plain}"; filename*=UTF-8''${exact}`;
}

/** What a file that is no picture is kept as where nothing better is known of it: bytes of no kind. */
export const PLAIN_BYTES = "application/octet-stream";

/**
 * What a file is kept as: a picture by its bytes, whatever it was called; else what its sender
 * called it, unless that was a picture, which it is not: such a file is bytes of no kind, so
 * that nothing that goes by a file's kind shows it in place.
 */
export function keptTypeOf(bytes: Uint8Array, declared: string | undefined): string {
  const picture = imageTypeOf(bytes);
  if (picture !== undefined) {
    return picture;
  }
  return declared === undefined || declared.toLowerCase().startsWith("image/")
    ? PLAIN_BYTES
    : declared;
}

/**
 * The bytes of a file that is no picture, handed over to save under its name and shown nowhere
 * in place: never sniffed, never run, whatever it was called.
 */
export function downloadResponse(c: Context<AppEnv>, name: string, bytes: Uint8Array): Response {
  c.header("content-type", PLAIN_BYTES);
  c.header("content-length", String(bytes.byteLength));
  c.header("content-disposition", `attachment; ${filenameParameters(name)}`);
  c.header("x-content-type-options", "nosniff");
  c.header("content-security-policy", "default-src 'none'; sandbox");
  c.header("cross-origin-resource-policy", "same-origin");
  return c.body(new Uint8Array(bytes).buffer);
}
