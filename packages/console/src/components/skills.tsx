import type { RestSkills } from "../api.js";
import { useWords } from "../i18n/index.js";
import { Callout, EmptyState, Spinner } from "./ui.js";

// The organization's skills, as SkillCDN serves them at the console's address: where a person
// reads each, and what an agent loads it by. Takes its data as props and nothing from the
// network; what the console answered is shown as text, never as HTML.

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
  if (skills.status === "none" || skills.address === null || skills.page === null) {
    return <EmptyState title={words.noAddress.title} body={words.noAddress.body} />;
  }
  const where = (
    <p className="sc-lead">
      {words.servedBy}{" "}
      <a href={skills.source} target="_blank" rel="noopener noreferrer">
        SkillCDN
      </a>{" "}
      {words.at}{" "}
      <a href={skills.page} target="_blank" rel="noopener noreferrer">
        <code>{skills.address}</code>
      </a>
      {words.howLoaded}
    </p>
  );
  if (skills.status !== "ready") {
    return (
      <>
        {where}
        <Callout tone={skills.status === "indexing" ? "info" : "warning"}>
          {words.status[skills.status]}
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
              <a
                className="sc-skill-name"
                href={skill.page}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {skill.name}
              </a>
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
