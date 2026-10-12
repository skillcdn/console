import { type FormEvent, useState } from "react";
import { fillRules, isReferenceRules, MAX_RULES_LENGTH, type RestRules } from "../api.js";
import { useLanguage, useWords } from "../i18n/index.js";
import { Writer } from "./documents.js";
import { Markdown } from "./markdown.js";
import { Button, Callout, Time } from "./ui.js";

// The rules of the board (ADR-0023), as the settings pages show them: what holds, where it
// comes from (the console's own, a page written, or none), who wrote the page and when, and
// the ways to change them for whoever may. Each takes its data as props and nothing from the
// network; the rules are Markdown rendered to elements, never HTML, with `{language}` filled
// with the language the pages speak, as the command fills it with the person's.

export interface RulesViewProps {
  readonly rules: RestRules;
  /** Whose rules: the workspace's, or a project's, which add to the workspace's. */
  readonly scope: "workspace" | "project";
  /** Where the rules are written; left out, they are read here and not changed. */
  readonly editHref?: string | undefined;
  /** Called to put the written rules away; left out, they stay. */
  readonly onArchive?: (() => void) | undefined;
  readonly busy?: boolean | undefined;
  /** Where a page of the project is read, by its path, for the links a project's rules make. */
  readonly docHref?: ((path: string) => string) | undefined;
  /** Whether the text stays folded under where it comes from, on a page where it is not the point. */
  readonly folded?: boolean | undefined;
}

export function RulesView(props: RulesViewProps) {
  const words = useWords();
  const language = useLanguage().tag;
  const { rules, scope } = props;
  const page = rules.page;
  if (rules.source === "none" || rules.body === null) {
    return (
      <div className="sc-rules">
        <p className="sc-muted">{words.rules.none}</p>
        {props.editHref !== undefined && (
          <div className="sc-rules-actions">
            <a className="sc-button sc-button-secondary" href={props.editHref}>
              {words.rules.write}
            </a>
          </div>
        )}
      </div>
    );
  }
  const text = <Markdown source={fillRules(rules.body, language)} docHref={props.docHref} />;
  return (
    <div className="sc-rules">
      {rules.source === "reference" ? (
        <Callout tone="info">{words.rules.reference}</Callout>
      ) : (
        page !== null && (
          <p className="sc-rules-facts">
            {words.docs.version(page.version)} · {words.docs.writtenBy}{" "}
            <Writer by={page.updatedBy} agent={page.agent} /> <Time iso={page.updatedAt} />
          </p>
        )
      )}
      {props.folded === true ? (
        <details className="sc-rules-fold">
          <summary>{words.rules.read}</summary>
          {text}
        </details>
      ) : (
        text
      )}
      {(props.editHref !== undefined || props.onArchive !== undefined) && (
        <div className="sc-rules-actions">
          {props.editHref !== undefined && (
            <a className="sc-button sc-button-secondary" href={props.editHref}>
              {rules.source === "reference" ? words.rules.writeOrganizations : words.common.edit}
            </a>
          )}
          {rules.source === "written" && props.onArchive !== undefined && (
            <Button variant="ghost" onClick={props.onArchive} disabled={props.busy === true}>
              {scope === "workspace" ? words.rules.useReference : words.common.remove}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export interface RulesFormProps {
  /** The rules as they hold now: what the form starts from when a page is written. */
  readonly rules: RestRules;
  readonly scope: "workspace" | "project";
  /** What the form starts from when a project adds none yet: the headings, and nothing an agent could mistake for a rule. */
  readonly template: string;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onSubmit: (input: {
    readonly body: string;
    readonly baseVersion?: number | undefined;
  }) => void;
  readonly onCancel?: (() => void) | undefined;
  /** Called to put the organization's page away, so that the console's own rules hold again; offered while one is written. */
  readonly onReset?: (() => void) | undefined;
}

/**
 * The form the rules are written on: prefilled with what holds (the console's own, for a
 * workspace that wrote none), and saving nothing that would change nothing: the text as it
 * is, or the console's own rules where they hold already. Where the organization's are
 * written, the console's own saved as they stand put the page away, as the reset does.
 */
export function RulesForm(props: RulesFormProps) {
  const words = useWords();
  const { rules, scope } = props;
  /** What holds now: the page written, or the console's own; nothing for a project that adds none. */
  const current = rules.source === "none" ? undefined : (rules.body ?? undefined);
  const [body, setBody] = useState(current ?? props.template);
  const unchanged =
    body.trim() === (current ?? "").trim() ||
    (scope === "workspace" && rules.source === "reference" && isReferenceRules(body));
  const ready = !unchanged && body.trim().length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) {
      return;
    }
    props.onSubmit({
      body,
      ...(rules.page === null ? {} : { baseVersion: rules.page.version }),
    });
  };

  return (
    <form className="sc-form" onSubmit={submit}>
      <label className="sc-field">
        <span className="sc-field-label">{words.rules.form.body}</span>
        <textarea
          className="sc-input sc-textarea sc-doc-editor"
          value={body}
          maxLength={MAX_RULES_LENGTH}
          rows={20}
          onChange={(event) => setBody(event.target.value)}
        />
        <span className="sc-muted">{words.rules.form.hint(MAX_RULES_LENGTH)}</span>
      </label>
      {props.error !== undefined && (
        <p className="sc-form-error" role="alert">
          {props.error}
        </p>
      )}
      <div className="sc-form-actions">
        <Button type="submit" variant="primary" disabled={props.busy === true || !ready}>
          {words.rules.form.save}
        </Button>
        {props.onCancel !== undefined && (
          <Button variant="ghost" onClick={props.onCancel}>
            {words.common.cancel}
          </Button>
        )}
        {props.onReset !== undefined && rules.source === "written" && (
          <Button variant="ghost" onClick={props.onReset} disabled={props.busy === true}>
            {words.rules.useReference}
          </Button>
        )}
      </div>
    </form>
  );
}
