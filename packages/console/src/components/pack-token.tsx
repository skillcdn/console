import type { RestPackConnectStarted } from "../api.js";
import { useWords } from "../i18n/index.js";
import { PackConnect, type PackConnectState } from "./pack-connect.js";
import { PackTokenForm } from "./projects.js";
import { Button } from "./ui.js";

// The SkillCDN token a private pack is read with (ADR-0028, ADR-0036), as a project's Settings
// page and the workspace's offer it: what the token is for, then the two ways to one side by
// side, a code approved at SkillCDN and a token made there by hand. Takes its data through the
// callbacks and keeps nothing itself; whose token it is, the page says in the title and the intro.

export interface PackTokenWaysProps {
  /** What the section is called, and what assistive technology reads it as. */
  readonly title: string;
  /** What the token is for, in the words of the page it is on. */
  readonly intro: string;
  /** Whether a token is held now, and since when. */
  readonly set: boolean;
  readonly setAt?: string | undefined;
  readonly busy?: boolean | undefined;
  /** Asks the deployment to connect; answers what the person is shown. */
  readonly onStart: () => Promise<RestPackConnectStarted>;
  /** How the connection stands, read when the page opens; changes nothing. */
  readonly poll: (signal?: AbortSignal) => Promise<PackConnectState>;
  /** Asks the console to claim the token at the deployment (ADR-0046). */
  readonly claim: (signal?: AbortSignal) => Promise<PackConnectState>;
  /** Gives the connection up. */
  readonly onCancelConnect: () => Promise<void>;
  /** Called once the token is kept. */
  readonly onConnected?: (() => void) | undefined;
  /** Called with a token made by hand, as typed or pasted. */
  readonly onSubmit: (token: string) => void;
  readonly onRemove?: (() => void) | undefined;
  /** Leaves the page without changing anything. */
  readonly onBack?: (() => void) | undefined;
}

export function PackTokenWays(props: PackTokenWaysProps) {
  const words = useWords();
  const pack = words.projects.packToken;
  return (
    <section className="sc-panel sc-panel-form" aria-label={props.title}>
      <h2 className="sc-section-title">{props.title}</h2>
      <p className="sc-pack-intro">{props.intro}</p>
      <div className="sc-pack-ways">
        <section className="sc-pack-way" aria-label={pack.connectTitle}>
          <h3 className="sc-pack-way-title">{pack.connectTitle}</h3>
          <PackConnect
            onStart={props.onStart}
            poll={props.poll}
            claim={props.claim}
            onCancel={props.onCancelConnect}
            onConnected={props.onConnected}
            busy={props.busy}
          />
        </section>
        <section className="sc-pack-way" aria-label={pack.pasteTitle}>
          <h3 className="sc-pack-way-title">{pack.pasteTitle}</h3>
          <PackTokenForm
            set={props.set}
            setAt={props.setAt}
            busy={props.busy}
            onSubmit={props.onSubmit}
            onRemove={props.onRemove}
          />
        </section>
      </div>
      {props.onBack !== undefined && (
        <div className="sc-form-actions sc-pack-actions">
          <Button variant="ghost" onClick={props.onBack}>
            {words.common.cancel}
          </Button>
        </div>
      )}
    </section>
  );
}
