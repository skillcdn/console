import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isDocumentPath } from "../documents.js";

// What people and agents write is untrusted. It is rendered as React elements, never as HTML:
// raw HTML in the source stays text, links are limited to a few schemes and open elsewhere,
// and pictures come over https only, lazily and without a referrer. A link whose destination
// is a document's path (ADR-0009) leads to the document's page, when the page knows where.

const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^https:\/\//i;

export interface MarkdownProps {
  readonly source: string;
  /** Where a document of the project is read, by its path; left out, such links stay text. */
  readonly docHref?: ((path: string) => string) | undefined;
  /**
   * Where a picture named in the text is read, when the text comes with files: given the
   * source of `![words](source)`, the address of the file it names, or nothing. A picture that
   * is neither one of those nor over https stays text.
   */
  readonly fileSrc?: ((source: string) => string | undefined) | undefined;
}

export function Markdown(props: MarkdownProps) {
  return (
    <div className="sc-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Everything passes through here unchanged; the components below decide what a URL may do.
        urlTransform={(url) => url}
        components={{
          a({ href, children }) {
            if (href === undefined || href === "") {
              return <span>{children}</span>;
            }
            if (href.startsWith("#")) {
              return <a href={href}>{children}</a>;
            }
            const hash = href.indexOf("#");
            const path = hash < 0 ? href : href.slice(0, hash);
            if (props.docHref !== undefined && isDocumentPath(path)) {
              return (
                <a href={`${props.docHref(path)}${hash < 0 ? "" : href.slice(hash)}`}>{children}</a>
              );
            }
            if (SAFE_LINK.test(href)) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
                  {children}
                </a>
              );
            }
            return <span>{children}</span>;
          },
          img({ src, alt, title }) {
            const named = typeof src === "string" ? props.fileSrc?.(src) : undefined;
            const url =
              named ?? (typeof src === "string" && SAFE_IMAGE.test(src) ? src : undefined);
            if (url === undefined) {
              return <span className="sc-prose-image-text">{alt ?? ""}</span>;
            }
            return (
              <img
                src={url}
                alt={alt ?? ""}
                title={title}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            );
          },
        }}
      >
        {props.source}
      </ReactMarkdown>
    </div>
  );
}
