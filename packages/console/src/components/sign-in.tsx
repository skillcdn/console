import { loginPath, type SignInFailure } from "../api.js";
import { Callout } from "./ui.js";

// The page a person sees before they are anyone: the way to the git host, and what went wrong
// the last time, when something did.

const FAILURE_WORDS: Readonly<Record<SignInFailure, string>> = {
  denied: "The git host did not confirm the sign-in: you said no, or it did.",
  expired: "The sign-in took too long or was finished in another browser. Try again.",
  failed: "The sign-in did not complete. Try again in a moment.",
  refused: "This account is not a member of the board. Ask whoever runs it to add your login.",
};

export interface SignInProps {
  readonly title: string;
  /** The git host people sign in through, or `undefined` where nobody can. */
  readonly signIn: "gh" | undefined;
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
      {props.signIn === undefined ? (
        <Callout tone="warning" title="Nobody can sign in here yet">
          Signing in is not configured on this console. Whoever runs it sets it up as{" "}
          <code>deploy/README.md</code> describes.
        </Callout>
      ) : (
        // A real navigation: signing in happens at the git host, not in this page.
        <a
          className="sc-button sc-button-primary sc-sign-in-button"
          href={loginPath(props.returnTo)}
        >
          Continue with GitHub
        </a>
      )}
    </div>
  );
}
