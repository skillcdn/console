import { loginPath, type RestProvider, type SignInFailure } from "../api.js";
import { Callout } from "./ui.js";

// The page a person sees before they are anyone: the way to each provider the deployment has,
// and what went wrong the last time, when something did.

const FAILURE_WORDS: Readonly<Record<SignInFailure, string>> = {
  denied: "The provider did not confirm the sign-in: you said no, or it did.",
  expired: "The sign-in took too long or was finished in another browser. Try again.",
  failed: "The sign-in did not complete. Try again in a moment.",
  refused: "This account is not a member of the board. Ask whoever runs it to add you.",
};

export interface SignInProps {
  readonly title: string;
  /** The identity providers people sign in through; none where nobody can. */
  readonly providers: readonly RestProvider[];
  /** The page to come back to, signed in: a path of this origin. */
  readonly returnTo: string;
  readonly failure?: SignInFailure | undefined;
}

export function SignIn(props: SignInProps) {
  return (
    <div className="sc-sign-in">
      <h1 className="sc-sign-in-title">{props.title}</h1>
      <p className="sc-sign-in-lead">
        The board of the work, the agents at it, what they did, and the decisions that wait for a
        person.
      </p>
      {props.failure !== undefined && (
        <Callout tone={props.failure === "refused" ? "warning" : "info"}>
          {FAILURE_WORDS[props.failure]}
        </Callout>
      )}
      {props.providers.length === 0 ? (
        <Callout tone="warning" title="Nobody can sign in here yet">
          Signing in is not configured on this console. Whoever runs it sets it up as{" "}
          <code>deploy/README.md</code> describes.
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
              Continue with {provider.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
