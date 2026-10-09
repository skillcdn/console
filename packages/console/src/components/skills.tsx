import type { RestSkills } from "../api.js";
import { Callout, EmptyState, Spinner } from "./ui.js";

// The organization's skills, as SkillCDN serves them at the console's address: where a person
// reads each, and what an agent loads it by. Takes its data as props and nothing from the
// network; what the console answered is shown as text, never as HTML.

export interface SkillListProps {
  /** What the console answered, or nothing while it has not yet. */
  readonly skills: RestSkills | undefined;
}

const STATUS_WORDS: Readonly<Record<Exclude<RestSkills["status"], "none" | "ready">, string>> = {
  indexing: "SkillCDN is still indexing the repository. Look again in a moment.",
  failed: "SkillCDN could not index the repository. What it found is on the address's page.",
  not_found:
    "SkillCDN does not serve this address, or serves it only to someone signed in there. The address's page says which.",
  unavailable: "SkillCDN could not be reached. The skills are as they were; look again later.",
};

export function SkillList(props: SkillListProps) {
  const { skills } = props;
  if (skills === undefined) {
    return <Spinner label="Loading the skills" />;
  }
  if (skills.status === "none" || skills.address === null || skills.page === null) {
    return (
      <EmptyState
        title="No skills address yet"
        body="This console has no address for the organization's skills. Whoever runs it names a repository served by SkillCDN in its configuration."
      />
    );
  }
  const where = (
    <p className="sc-lead">
      The organization's skills, served by{" "}
      <a href={skills.source} target="_blank" rel="noopener noreferrer">
        SkillCDN
      </a>{" "}
      at{" "}
      <a href={skills.page} target="_blank" rel="noopener noreferrer">
        <code>{skills.address}</code>
      </a>
      . An agent loads one through its SkillCDN connection; a person reads it at its page.
    </p>
  );
  if (skills.status !== "ready") {
    return (
      <>
        {where}
        <Callout tone={skills.status === "indexing" ? "info" : "warning"}>
          {STATUS_WORDS[skills.status]}
        </Callout>
      </>
    );
  }
  if (skills.items.length === 0) {
    return (
      <>
        {where}
        <EmptyState
          title="No skills at this address"
          body="The repository is served, and SkillCDN found no skill in it."
        />
      </>
    );
  }
  return (
    <>
      {where}
      <ul className="sc-skills" aria-label="Skills">
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
