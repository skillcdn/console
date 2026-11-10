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
