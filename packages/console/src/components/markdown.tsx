import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// What people and agents write is untrusted. It is rendered as React elements, never as HTML:
// raw HTML in the source stays text, links are limited to a few schemes and open elsewhere,
// and pictures come over https only, lazily and without a referrer.

const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^https:\/\//i;

export function Markdown(props: { readonly source: string }) {
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
            const url = typeof src === "string" && SAFE_IMAGE.test(src) ? src : undefined;
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
