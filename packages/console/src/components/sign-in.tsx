import { type MouseEvent, useEffect, useState } from "react";
import { loginPath, type ProviderKey, type RestProvider, type SignInFailure } from "../api.js";
import { useWords } from "../i18n/index.js";
import type { Brand } from "./shell.js";
import { Callout, cx } from "./ui.js";

// The page a person sees before they are anyone: the way to each provider the deployment has,
// who gets in through it, and what went wrong the last time, when something did.

export interface SignInProps {
  readonly title: string;
  /** The marks to show above the name; none shows the name alone (ADR-0013). */
  readonly brand?: Brand | undefined;
  /** The identity providers people sign in through; none where nobody can. */
  readonly providers: readonly RestProvider[];
  /** The page to come back to, signed in: a path of this origin. */
  readonly returnTo: string;
  readonly failure?: SignInFailure | undefined;
}

export function SignIn(props: SignInProps) {
  const words = useWords().signIn;
  // The way being taken: its button says so from the click until the page leaves, and says so
  // no more when the browser brings this page back from its cache, as on the way back.
  const [taken, setTaken] = useState<ProviderKey | undefined>(undefined);
  useEffect(() => {
    const shown = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        setTaken(undefined);
      }
    };
    window.addEventListener("pageshow", shown);
    return () => window.removeEventListener("pageshow", shown);
  }, []);
  const take = (provider: ProviderKey) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (taken !== undefined) {
      // One way at a time: a second click, on any of the buttons, goes nowhere.
      event.preventDefault();
      return;
    }
    setTaken(provider);
  };
  const admitsOf = (admits: NonNullable<RestProvider["admits"]>): string => {
    if (admits.organization !== null) {
      return words.admits.organization(admits.organization);
    }
    if (admits.domains.length > 0) {
      return words.admits.domains(admits.domains.join(", "));
    }
    return words.admits.listed;
  };
  return (
    <div className="sc-sign-in">
      {props.brand?.symbol !== undefined && (
        <div className="sc-sign-in-stage" aria-hidden="true">
          <span className="sc-sign-in-badge">
            <img className="sc-sign-in-symbol" src={props.brand.symbol} alt="" />
          </span>
        </div>
      )}
      {props.brand?.wordmark !== undefined && (
        <img className="sc-sign-in-wordmark" src={props.brand.wordmark} alt="" />
      )}
      <h1 className="sc-sign-in-title">{props.title}</h1>
      <p className="sc-sign-in-lead">{words.lead}</p>
      {props.failure !== undefined && (
        <Callout tone={props.failure === "refused" ? "warning" : "info"}>
          {words.failure[props.failure]}
        </Callout>
      )}
      {props.providers.length === 0 ? (
        <Callout tone="warning" title={words.nobody.title}>
          {words.nobody.body}
        </Callout>
      ) : (
        <div className="sc-sign-in-ways">
          {props.providers.map((provider) => {
            const going = taken === provider.key;
            return (
              <div key={provider.key} className="sc-sign-in-way">
                {/* A real navigation: signing in happens at the provider, not in this page. */}
                <a
                  className={cx(
                    "sc-button sc-button-primary sc-sign-in-button",
                    going && "sc-sign-in-button-going",
                  )}
                  href={loginPath(provider.key, props.returnTo)}
                  aria-busy={going ? true : undefined}
                  aria-disabled={taken !== undefined && !going ? true : undefined}
                  onClick={take(provider.key)}
                >
                  <ProviderMark provider={provider.key} />
                  <span className="sc-sign-in-button-label">
                    {going ? words.going(provider.label) : words.signInWith(provider.label)}
                  </span>
                  {going && (
                    <span className="sc-spinner sc-sign-in-spinner" aria-hidden="true">
                      <span className="sc-spinner-ring" />
                    </span>
                  )}
                </a>
                {provider.admits !== undefined && (
                  <p className="sc-sign-in-admits">{admitsOf(provider.admits)}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The provider's mark, as people know it from sign-in buttons elsewhere, beside the label and
 * decorative: the host's own mark in the button's text color, Google's lettermark on a light
 * tile, since its colors are its own. A provider without a mark shows the label alone.
 */
function ProviderMark(props: { readonly provider: ProviderKey }) {
  if (props.provider === "gh") {
    return (
      <svg
        className="sc-sign-in-mark"
        viewBox="0 0 16 16"
        width="20"
        height="20"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="currentColor"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
    );
  }
  if (props.provider === "google") {
    return (
      <span className="sc-sign-in-mark sc-sign-in-mark-tile" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true" focusable="false">
          <path
            fill="#FFC107"
            d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
          />
          <path
            fill="#FF3D00"
            d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
          />
          <path
            fill="#4CAF50"
            d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
          />
          <path
            fill="#1976D2"
            d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
          />
        </svg>
      </span>
    );
  }
  return null;
}
