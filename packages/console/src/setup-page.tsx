import { useCallback } from "react";
import { useRead } from "./agent-page.js";
import { ApiError, type ConsoleClient, normalizeConnectCode } from "./api.js";
import { SetupGuideView } from "./components/setup.js";
import { Callout, EmptyState, LinkButton, Spinner } from "./components/ui.js";
import { useWords } from "./i18n/index.js";
import { PATHS } from "./router.js";
import { setupGuideOf } from "./setup-guide.js";

// What an invitation's code opens, as a page (ADR-0088): the guide of one agent account's
// setup, read without a sign-in by whoever holds the code. It shows nothing else of the console,
// and says of a code that opens nothing only that it opens nothing.

export function SetupPage(props: { readonly client: ConsoleClient; readonly code: string }) {
  const all = useWords();
  const words = all.setup;
  const { client } = props;
  const code = normalizeConnectCode(props.code);
  const read = useCallback(
    (signal: AbortSignal) =>
      code === undefined ? Promise.resolve(null) : client.agentSetup(code, signal),
    [client, code],
  );
  const found = useRead(read);
  const gone =
    code === undefined || (found.failed instanceof ApiError && found.failed.status === 404);
  if (gone) {
    return (
      <EmptyState
        title={words.notFound.title}
        body={words.notFound.body}
        action={<LinkButton href={PATHS.projects}>{words.home}</LinkButton>}
      />
    );
  }
  if (found.value === undefined || found.value === null) {
    return found.failed === undefined ? (
      <div className="sc-loading">
        <Spinner label={all.common.loading} />
      </div>
    ) : (
      <Callout tone="danger">{words.couldNotLoad}</Callout>
    );
  }
  return <SetupGuideView guide={setupGuideOf(found.value, code)} account={found.value.account} />;
}
