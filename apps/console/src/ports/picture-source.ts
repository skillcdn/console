// A picture from elsewhere, fetched for a page the console shows (ADR-0048): what people and
// agents name in Markdown, and what the git hosts serve as a person's picture. The console
// fetches it, so that the person's browser reaches nobody's server, from a public address
// only and bounded; the adapter fetches over HTTPS, and the tests answer from memory.

export interface PictureRequest {
  /** An https URL, as it was written. */
  readonly url: string;
  /** What the picture was last fetched with, for the source to answer `unchanged` to. */
  readonly etag?: string | undefined;
  readonly lastModified?: string | undefined;
}

/**
 * Why a picture is not fetched: never from there (not https, or an address of the console's
 * own network), not a picture at all or too large, or not now (the origin answered an error,
 * or could not be reached in time).
 */
export type PictureRefusal =
  | "not_https"
  | "private_address"
  | "not_a_picture"
  | "too_large"
  | "upstream"
  | "unreachable";

export type PictureFetch =
  | {
      readonly kind: "picture";
      readonly bytes: Uint8Array;
      readonly contentType: string;
      /** What the origin said the picture is, for asking again later. */
      readonly etag: string | undefined;
      readonly lastModified: string | undefined;
    }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: PictureRefusal };

export interface PictureSource {
  fetch(request: PictureRequest): Promise<PictureFetch>;
}

/** The URL a picture is fetched from, or nothing: https, on its default port, with no credentials in it. */
export function pictureUrlOf(text: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === ""
    ? url
    : undefined;
}
