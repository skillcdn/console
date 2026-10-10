import { loginPath, type RestProvider, type SignInFailure } from "../api.js";
import { useWords } from "../i18n/index.js";
import { Callout } from "./ui.js";

// The page a person sees before they are anyone: the way to each provider the deployment has,
// and what went wrong the last time, when something did.

export interface SignInProps {
  readonly title: string;
  /** The identity providers people sign in through; none where nobody can. */
  readonly providers: readonly RestProvider[];
  /** The page to come back to, signed in: a path of this origin. */
  readonly returnTo: string;
  readonly failure?: SignInFailure | undefined;
}

export function SignIn(props: SignInProps) {
  const words = useWords().signIn;
  return (
    <div className="sc-sign-in">
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
          {props.providers.map((provider) => (
            // A real navigation: signing in happens at the provider, not in this page.
            <a
              key={provider.key}
              className="sc-button sc-button-primary sc-sign-in-button"
              href={loginPath(provider.key, props.returnTo)}
            >
              {words.continueWith(provider.label)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
