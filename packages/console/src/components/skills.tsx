import type { RestSkills } from "../api.js";
import { useWords } from "../i18n/index.js";
import { Callout, EmptyState, Spinner } from "./ui.js";

// A project's skills, as the pack lists them: at a SkillCDN deployment, where a person reads
// each and what an agent loads it by; or from a directory on the console's machine (ADR-0031),
// with nothing to link to. Takes its data as props and nothing from the network; what the
// console answered is shown as text, never as HTML.

export interface SkillListProps {
  /** What the console answered, or nothing while it has not yet. */
  readonly skills: RestSkills | undefined;
}

export function SkillList(props: SkillListProps) {
  const words = useWords().skills;
  const { skills } = props;
  if (skills === undefined) {
    return <Spinner label={words.loading} />;
  }
  // The console could not answer for the deployment at all: said as such, not as no address.
  if (skills.status === "unavailable" && skills.address === null) {
    return <Callout tone="warning">{words.status.unavailable}</Callout>;
  }
  if (skills.status === "none" || skills.address === null) {
    return <EmptyState title={words.noAddress.title} body={words.noAddress.body} />;
  }
  const deployment =
    skills.source !== null && skills.page !== null
      ? { source: skills.source, page: skills.page }
      : undefined;
  const local = deployment === undefined;
  const where =
    deployment === undefined ? (
      <>
        <p className="sc-lead">
          {words.fromMachine} <code>{skills.address}</code>
        </p>
        <p className="sc-muted">{words.connectLocal}</p>
      </>
    ) : (
      <>
        <p className="sc-lead">
          {words.servedBy}{" "}
          <a href={deployment.source} target="_blank" rel="noopener noreferrer">
            SkillCDN
          </a>{" "}
          {words.at}{" "}
          <a href={deployment.page} target="_blank" rel="noopener noreferrer">
            <code>{skills.address}</code>
          </a>
        </p>
        <p className="sc-muted">
          {words.connect}{" "}
          <a href={deployment.page} target="_blank" rel="noopener noreferrer">
            {words.connectLink}
          </a>
        </p>
      </>
    );
  if (skills.status !== "ready") {
    return (
      <>
        {where}
        <Callout tone={skills.status === "indexing" ? "info" : "warning"}>
          {(local ? words.localStatus[skills.status] : undefined) ?? words.status[skills.status]}
        </Callout>
      </>
    );
  }
  if (skills.items.length === 0) {
    return (
      <>
        {where}
        <EmptyState title={words.none.title} body={words.none.body} />
      </>
    );
  }
  return (
    <>
      {where}
      <ul className="sc-skills" aria-label={words.list}>
        {skills.items.map((skill) => (
          <li key={skill.path} className="sc-skill">
            <p className="sc-skill-head">
              {skill.page === null ? (
                <span className="sc-skill-name">{skill.name}</span>
              ) : (
                <a
                  className="sc-skill-name"
                  href={skill.page}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {skill.name}
                </a>
              )}
              <span className="sc-muted">{skill.directory === "" ? "/" : skill.directory}</span>
            </p>
            <p className="sc-skill-description">{skill.description}</p>
            {skill.uri !== null && <code className="sc-skill-uri">{skill.uri}</code>}
          </li>
        ))}
      </ul>
    </>
  );
}
