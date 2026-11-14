// The brand's marks, as main.tsx takes them (ADR-0013): the crumbs stand after the lockup.
import symbol from "@skillcdn/brand/symbol.svg";
import wordmark from "@skillcdn/brand/wordmark-black.svg";
import {
  Avatar,
  Badge,
  type BoardFilter,
  BoardFilters,
  Button,
  Calendar,
  Callout,
  CategoryBadge,
  Chip,
  CONSOLE_TOKENS,
  CopyButton,
  cx,
  Day,
  DocumentCrumbs,
  DueBadge,
  EmptyState,
  ENGLISH,
  filterTasks,
  formatBytes,
  GOAL_STATES,
  GoalStateBadge,
  KindMark,
  KOREAN,
  LanguageContext,
  LinkButton,
  listSearch,
  Markdown,
  Pager,
  PersonChip,
  PersonOption,
  Picker,
  PriorityBadge,
  ProgressBar,
  ProjectMark,
  peopleSearch,
  type RestPerson,
  type RestTeam,
  RoleBadge,
  RUN_STATUSES,
  RunStatusBadge,
  ShowMore,
  Spinner,
  StateBadge,
  TASK_STATES,
  TaskList,
  Time,
  useWords,
  Workers,
} from "@skillcdn/console";
import {
  Children,
  type CSSProperties,
  type FormEvent,
  isValidElement,
  type ReactElement,
  type ReactNode,
  StrictMode,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
// The page stands on the console's own stylesheet and face, as main.tsx loads them.
import "@skillcdn/console/console.css";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
// biome-ignore lint/correctness/useImportExtensions: the page's own stylesheet beside this file, not a module
import "./parts.css";
import {
  alice,
  bob,
  carol,
  categories,
  closeGoal,
  counts,
  dave,
  erin,
  FIGURE,
  goals,
  juno,
  ledger,
  MONTH,
  mira,
  NOW,
  PORTRAIT,
  payrollProject,
  people,
  reconcile,
  SEAL,
  TODAY,
  tasks,
  teams,
  WRITTEN_TEXT,
} from "./parts-data.js";

// Every part of the console's pages by itself (packages/console/src/styles/README.md, the
// catalogue): the tokens, then a section for each row of the catalogue, in its order, with the
// part in every variant, size and state it has. For whoever changes how the pages look: a part
// is looked at here, alone and whole, before the pages that use it. A page of the development
// server only (`pnpm dev`, at /parts): the build's input is index.html alone, and the image
// carries none of this. It asks nothing of the API and needs nobody signed in; what a component
// takes is invented (parts-data.ts). `pnpm check:styles` holds the sections to the catalogue.

// --- the page's own pieces ---------------------------------------------------------------------

interface PartProps {
  /** The part's name, as its row of the catalogue has it. Written first, a plain string: the check reads it from this file's text. */
  readonly name: string;
  /** The classes that are the part's own, as the row lists them. */
  readonly classes: string;
  /** What the part is for, in a line. */
  readonly use: string;
  /** What the part lies on in a real page: a pane, as most do, or the field itself, as a pane does. */
  readonly ground?: "pane" | "field";
  readonly children: ReactNode;
}

/** One part's section: its name, its classes, what it is for, and the part itself below. */
function Part(props: PartProps) {
  const head = (
    <>
      <div className="sc-section-head">
        <h2 className="sc-section-title">{props.name}</h2>
        <code className="sc-muted">{props.classes}</code>
      </div>
      <p className="sc-muted">{props.use}</p>
    </>
  );
  if (props.ground === "field") {
    // A pane within a pane would be glass over glass: the head keeps the section's pane, and
    // the part lies under it on the field, where a real page has it.
    return (
      <section id={props.name} aria-label={props.name}>
        <div className="sc-panel">{head}</div>
        <div className="dev-specimens dev-specimens-field">{props.children}</div>
      </section>
    );
  }
  return (
    <section id={props.name} className="sc-panel" aria-label={props.name}>
      {head}
      <div className="dev-specimens">{props.children}</div>
    </section>
  );
}

/** One showing of a part: what is shown, in the small capitals, over the part; `row` for small things side by side. */
function Specimen(props: {
  readonly label: string;
  readonly row?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="dev-specimen">
      <p className="sc-eyebrow">{props.label}</p>
      {props.row === true ? <div className="dev-row">{props.children}</div> : props.children}
    </div>
  );
}

/** The header's bar, held still: what the crumbs, the person's menu and the tabs lie on. */
function HeaderBar(props: { readonly children: ReactNode }) {
  return <div className="sc-header dev-static">{props.children}</div>;
}

/** The caret of a menu's label and of a tab that opens a list, as the shell draws it. */
function Caret() {
  return (
    <svg className="sc-menu-caret" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 6l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A form here sends nothing anywhere. */
const stay = (event: FormEvent) => event.preventDefault();

const SIZES = ["xs", "sm", "md", "lg", "xl"] as const;

// --- the tokens --------------------------------------------------------------------------------

/** The tokens whose names begin so, in the order the package lists them. */
const tokens = (...prefixes: readonly string[]): readonly string[] =>
  CONSOLE_TOKENS.filter((name) => prefixes.some((prefix) => name.startsWith(prefix)));

// What a swatch is drawn with is the token it shows and the tokens around it, set on the
// element: this page's measure of a value, and no look of the page's own.
const colourOf = (name: string): CSSProperties => ({
  background: `var(${name})`,
  border: "var(--sc-border)",
  borderRadius: "var(--sc-radius-md)",
});
const radiusOf = (name: string): CSSProperties => ({
  background: "var(--sc-color-accent-subtle)",
  border: "var(--sc-border-strong)",
  borderRadius: `var(${name})`,
});
const shadowOf = (name: string): CSSProperties => ({
  background: "var(--sc-color-bg-raised)",
  borderRadius: "var(--sc-radius-lg)",
  boxShadow: `var(${name})`,
});
const spaceOf = (name: string): CSSProperties => ({
  width: `var(${name})`,
  background: "var(--sc-color-accent-solid)",
});

/** A token's name, as a key reads. */
function TokenName(props: { readonly name: string }) {
  return <code className="sc-project-key">{props.name}</code>;
}

function Swatches(props: {
  readonly names: readonly string[];
  readonly styleOf: (name: string) => CSSProperties;
  readonly shape?: boolean;
}) {
  return (
    <div className="dev-swatches">
      {props.names.map((name) => (
        <div key={name} className="dev-swatch">
          <span
            className={props.shape === true ? "dev-swatch-shape" : "dev-swatch-colour"}
            style={props.styleOf(name)}
          />
          <TokenName name={name} />
        </div>
      ))}
    </div>
  );
}

/** A scale of type: a row per step, set in it. */
function TypeScale(props: {
  readonly names: readonly string[];
  readonly styleOf: (name: string) => CSSProperties;
}) {
  return (
    <div className="dev-scale">
      {props.names.map((name) => (
        <div key={name} className="dev-scale-row">
          <TokenName name={name} />
          <span style={props.styleOf(name)}>Acme closes its books on the fifth</span>
        </div>
      ))}
    </div>
  );
}

/** The values every part reads (styles/tokens.css), by the names the package lists them under. */
function Tokens() {
  return (
    <section id="tokens" className="sc-panel" aria-label="tokens">
      <div className="sc-section-head">
        <h2 className="sc-section-title">tokens</h2>
        <code className="sc-muted">--sc-*</code>
      </div>
      <p className="sc-muted">
        Every value: the colours, the type, the space, the shape. A part reads them and writes none
        of its own.
      </p>
      <div className="dev-specimens">
        <Specimen label="Colours">
          <Swatches names={tokens("--sc-color-")} styleOf={colourOf} />
        </Specimen>
        <Specimen label="Colours of a series">
          <Swatches names={tokens("--sc-series-")} styleOf={colourOf} />
        </Specimen>
        <Specimen label="Type: the sizes">
          <TypeScale
            names={tokens("--sc-text-")}
            styleOf={(name) => ({ fontSize: `var(${name})` })}
          />
        </Specimen>
        <Specimen label="Type: the weights and the faces">
          <TypeScale
            names={tokens("--sc-weight-")}
            styleOf={(name) => ({ fontWeight: `var(${name})` })}
          />
          <TypeScale
            names={tokens("--sc-font-")}
            styleOf={(name) => ({ fontFamily: `var(${name})` })}
          />
        </Specimen>
        <Specimen label="Space">
          <div className="dev-scale">
            {tokens("--sc-space-").map((name) => (
              <div key={name} className="dev-scale-row">
                <TokenName name={name} />
                <span className="dev-measure" style={spaceOf(name)} />
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen label="Radii">
          <Swatches names={tokens("--sc-radius-")} styleOf={radiusOf} shape />
        </Specimen>
        <Specimen label="Shadows">
          <Swatches
            names={tokens("--sc-shadow-", "--sc-glow", "--sc-glass-lift")}
            styleOf={shadowOf}
            shape
          />
        </Specimen>
      </div>
    </section>
  );
}

// --- specimens that hold a state of their own --------------------------------------------------

function Pickers() {
  const [found, setFound] = useState<RestPerson | undefined>(undefined);
  const [chosen, setChosen] = useState<RestPerson | undefined>(bob);
  const [manager, setManager] = useState<RestPerson | undefined>(alice);
  const [nobody, setNobody] = useState<RestPerson | undefined>(undefined);
  const search = peopleSearch(people);
  const person = (candidate: RestPerson) => <PersonChip person={candidate} />;
  const option = (candidate: RestPerson) => <PersonOption person={candidate} />;
  return (
    <>
      <Specimen label="The field: enter it, and it lists what the words find">
        <div className="dev-fields">
          <Picker
            value={found}
            search={search}
            keyOf={(candidate) => candidate.id}
            render={person}
            renderOption={option}
            label="A worker"
            placeholder="Find a person"
            onChange={setFound}
          />
          <Picker
            value={undefined}
            search={search}
            keyOf={(candidate) => candidate.id}
            render={person}
            label="A worker, not to be changed"
            placeholder="Find a person"
            disabled
            onChange={() => undefined}
          />
        </div>
      </Specimen>
      <Specimen label="Chosen, with the way to clear it; and a choice held until it is read back">
        <div className="dev-fields">
          <Picker
            value={chosen}
            search={search}
            keyOf={(candidate) => candidate.id}
            render={person}
            renderOption={option}
            label="A worker"
            placeholder="Find a person"
            onChange={setChosen}
          />
          <Picker
            value={undefined}
            held="The February close"
            search={search}
            keyOf={(candidate) => candidate.id}
            render={person}
            label="A goal"
            placeholder="Any goal"
            onChange={() => undefined}
          />
        </div>
      </Specimen>
      <Specimen label="Quiet: a fact changed in place, chosen and not">
        <div className="dev-fields">
          <Picker
            className="sc-picker-quiet"
            value={manager}
            search={search}
            keyOf={(candidate) => candidate.id}
            render={person}
            renderOption={option}
            label="The manager"
            placeholder="Nobody"
            onChange={setManager}
          />
          <Picker
            className="sc-picker-quiet"
            value={nobody}
            search={search}
            keyOf={(candidate) => candidate.id}
            render={person}
            renderOption={option}
            label="The manager"
            placeholder="Nobody"
            onChange={setNobody}
          />
        </div>
      </Specimen>
      <Specimen label="Add: the way to one more, at the end of a row of chips">
        <TeamChips />
      </Specimen>
      <Specimen label="The list, as it opens under the field">
        <div className="dev-narrow">
          {/* The list of the picker above, written out: open over the page it would hide what follows. */}
          <div className="sc-picker-list dev-static">
            <div className="sc-picker-option sc-picker-option-active">
              <PersonOption person={alice} />
            </div>
            <div className="sc-picker-option">
              <PersonOption person={bob} />
            </div>
            <div className="sc-picker-option">
              <PersonOption person={mira} />
            </div>
            <div className="sc-picker-note">
              <button type="button" className="sc-button sc-button-ghost sc-button-sm">
                Show more
              </button>
            </div>
          </div>
        </div>
      </Specimen>
      <Specimen label="The list, with nothing found">
        <div className="dev-narrow">
          <div className="sc-picker-list dev-static">
            <div className="sc-picker-note sc-muted">Nothing matches</div>
          </div>
        </div>
      </Specimen>
    </>
  );
}

/** A row of chips a person adds to and takes from: the teams someone is in. */
function TeamChips() {
  const [joined, setJoined] = useState<readonly RestTeam[]>(teams.slice(0, 2));
  const toJoin = teams.filter((team) => !joined.includes(team));
  return (
    <div className="sc-chips">
      {joined.map((team) => (
        <Chip
          key={team.id}
          onRemove={() => setJoined(joined.filter((held) => held !== team))}
          removeLabel={`Remove: ${team.name}`}
        >
          {team.name}
        </Chip>
      ))}
      {toJoin.length > 0 && (
        <Picker<RestTeam>
          className="sc-picker-add"
          value={undefined}
          search={listSearch(toJoin, (team, typed) => team.name.toLowerCase().includes(typed))}
          keyOf={(team) => team.id}
          render={(team) => team.name}
          label="Add to a team"
          placeholder="Add to a team"
          onChange={(team) => {
            if (team !== undefined) {
              setJoined([...joined, team]);
            }
          }}
        />
      )}
    </div>
  );
}

function Pagers() {
  const [page, setPage] = useState(1);
  const [rest, setRest] = useState(130);
  return (
    <>
      <Specimen label="Turned by pages: no step before the first, none after the last">
        <Pager page={page} pages={5} total={92} pageSize={20} onPage={setPage} />
      </Specimen>
      <Specimen label="Each page an address">
        <Pager page={3} pages={5} total={92} pageSize={20} pageHref={() => "#pager"} />
      </Specimen>
      <Specimen label="Grown by a page at a time">
        <ShowMore rest={rest} onMore={() => setRest((left) => (left > 50 ? left - 50 : 130))} />
      </Specimen>
    </>
  );
}

function Filters() {
  const [filter, setFilter] = useState<BoardFilter>({ category: "bookkeeping" });
  return (
    <BoardFilters
      filter={filter}
      categories={categories}
      goals={goals}
      people={people}
      me={alice}
      shown={filterTasks(tasks, filter, alice).length}
      total={tasks.length}
      onChange={setFilter}
    />
  );
}

/** A member as a card of the people's page, with what stands in its facts and at its foot. */
function PersonCard(props: {
  readonly person: RestPerson;
  readonly you?: boolean;
  readonly out?: boolean;
  readonly note: string;
  readonly children: ReactNode;
}) {
  const { person } = props;
  return (
    <li className={cx("sc-person-card", props.out === true && "sc-person-card-out")}>
      <div className="sc-person-card-head">
        <Avatar person={person} size="lg" />
        <div className="sc-person-card-who">
          <span className="sc-person-card-name">
            <a className="sc-person-card-link" href="#person">
              {person.name ?? person.login}
            </a>
            {person.kind === "agent" && <Badge>Agent</Badge>}
            {props.you === true && <span className="sc-person-you">you</span>}
          </span>
          {typeof person.title === "string" && (
            <span className="sc-person-card-title">{person.title}</span>
          )}
          <span className="sc-person-card-note">{props.note}</span>
        </div>
      </div>
      <dl className="sc-person-facts">{props.children}</dl>
      <div className="sc-person-card-ways">
        <a className="sc-button sc-button-ghost sc-button-sm" href="#person">
          Work
        </a>
        <a className="sc-button sc-button-ghost sc-button-sm" href="#person">
          Agents
        </a>
        <Button variant="ghost" size="sm">
          {props.out === true ? "Let back in" : "Deactivate"}
        </Button>
      </div>
    </li>
  );
}

function PersonCards() {
  const [manager, setManager] = useState<RestPerson | undefined>(alice);
  return (
    <ul className="sc-people">
      <PersonCard person={alice} you note="alice · Member of acme">
        <div className="sc-person-fact">
          <dt>Role</dt>
          <dd>
            <RoleBadge role={alice.role} />
          </dd>
        </div>
        <div className="sc-person-fact">
          <dt>Manager</dt>
          <dd>
            <span className="sc-muted">Nobody</span>
          </dd>
        </div>
        <div className="sc-person-fact">
          <dt>Work email</dt>
          <dd>
            <span className="sc-person-email">alice@acme.test</span>
          </dd>
        </div>
        <div className="sc-person-fact">
          <dt>Direct reports</dt>
          <dd>
            <span className="sc-person-reports">
              <span className="sc-workers">
                {[bob, carol, erin].map((report) => (
                  <Avatar key={report.id} person={report} size="sm" />
                ))}
              </span>
              <span className="sc-muted">4 people</span>
            </span>
          </dd>
        </div>
      </PersonCard>
      <PersonCard person={bob} note="bob · Member of acme">
        <div className="sc-person-fact">
          <dt>Title</dt>
          <dd>
            <input
              className="sc-input sc-input-quiet"
              aria-label="Title of Bob Arroyo"
              defaultValue="Accountant"
              placeholder="Nobody"
            />
          </dd>
        </div>
        <div className="sc-person-fact">
          <dt>Role</dt>
          <dd>
            <select
              className="sc-input sc-input-quiet"
              aria-label="Role of Bob Arroyo"
              defaultValue="member"
            >
              <option value="admin">Administrator</option>
              <option value="member">Member</option>
            </select>
          </dd>
        </div>
        <div className="sc-person-fact">
          <dt>Manager</dt>
          <dd>
            <Picker
              className="sc-picker-quiet"
              value={manager}
              search={peopleSearch(people.filter((candidate) => candidate !== bob))}
              keyOf={(candidate) => candidate.id}
              render={(candidate) => <PersonChip person={candidate} />}
              renderOption={(candidate) => <PersonOption person={candidate} />}
              label="Manager of Bob Arroyo"
              placeholder="Nobody"
              onChange={setManager}
            />
          </dd>
        </div>
        <div className="sc-person-fact">
          <dt>Teams</dt>
          <dd>
            <TeamChips />
          </dd>
        </div>
      </PersonCard>
      <PersonCard person={mira} note="@mira · Listed by an administrator">
        <div className="sc-person-fact">
          <dt>Role</dt>
          <dd>
            <RoleBadge role={mira.role} />
          </dd>
        </div>
        <div className="sc-person-fact">
          <dt>Manager</dt>
          <dd>
            <PersonChip person={alice} />
          </dd>
        </div>
      </PersonCard>
      <PersonCard person={juno} out note="@juno · Out since Feb 20">
        <div className="sc-person-fact">
          <dt>Role</dt>
          <dd>
            <RoleBadge role={juno.role} />
          </dd>
        </div>
        <div className="sc-person-fact">
          <dt>Manager</dt>
          <dd>
            <PersonChip person={bob} />
          </dd>
        </div>
      </PersonCard>
    </ul>
  );
}

/** The panel of the person's menu, as the shell writes it. */
function MenuPanel(props: { readonly className?: string }) {
  return (
    <div className={cx("sc-menu-panel", props.className)}>
      <p className="sc-menu-who">
        <span>Alice Lindqvist</span>
        <span className="sc-muted">alice</span>
      </p>
      <nav className="sc-menu-list" aria-label="Workspace">
        <a className="sc-menu-link" href="#menu" aria-current="page">
          Projects
        </a>
        <a className="sc-menu-link" href="#menu">
          My work
        </a>
        <a className="sc-menu-link" href="#menu">
          People
        </a>
        <p className="sc-menu-heading">Plugins</p>
        <a className="sc-menu-link" href="#menu">
          Leave
        </a>
        <a className="sc-menu-link" href="#menu">
          Expenses
        </a>
      </nav>
      <fieldset className="sc-menu-languages">
        <legend className="sc-menu-heading">Language</legend>
        <button type="button" className="sc-menu-link sc-menu-chosen" aria-pressed="true">
          {ENGLISH.label}
        </button>
        <button type="button" lang={KOREAN.tag} className="sc-menu-link" aria-pressed="false">
          {KOREAN.label}
        </button>
      </fieldset>
      <button type="button" className="sc-menu-link sc-menu-out">
        Sign out
      </button>
    </div>
  );
}

/** One task's page, laid out as the task view lays it out. */
function Detail() {
  const words = useWords();
  const task = reconcile;
  return (
    <div className="sc-task">
      <header className="sc-task-header">
        <div className="sc-task-heading">
          <h3 className="sc-task-title">
            <span className="sc-card-number">#{task.number}</span> {task.title}
          </h3>
          <div className="sc-task-badges">
            <StateBadge state={task.state} />
            {task.category !== null && <CategoryBadge category={task.category} />}
            <PriorityBadge priority={task.priority} />
            {task.dueOn !== null && (
              <DueBadge dueOn={task.dueOn} state={task.state} today={TODAY} />
            )}
          </div>
        </div>
        <div className="sc-task-actions">
          <a className="sc-button sc-button-secondary" href="#detail">
            Edit
          </a>
          <a className="sc-button sc-button-secondary" href="#detail">
            Raise a decision
          </a>
          <Button variant="secondary">Archive</Button>
        </div>
      </header>
      <div className="sc-task-body">
        <div className="sc-task-main">
          <Markdown
            source={
              "The close is three differences away. Each is in the ledger, and the closing checklist says what a closed month needs.\n\n- The bank statement of the 27th, imported twice\n- A card payment with no account"
            }
          />
          <section className="sc-task-section" aria-label="Links">
            <h4 className="sc-section-title">Links</h4>
            <ul className="sc-link-list">
              {task.links.map((link) => (
                <li key={link.url}>
                  <a href="#detail">{link.label ?? link.url}</a>
                </li>
              ))}
            </ul>
          </section>
          <section className="sc-task-section" aria-label="Discussion">
            <h4 className="sc-section-title">Discussion</h4>
            <p className="sc-muted">Nothing was said about this task yet.</p>
          </section>
        </div>
        <aside className="sc-task-aside" aria-label="Facts">
          <dl className="sc-facts">
            <div>
              <dt>State</dt>
              <dd>
                <select className="sc-input" aria-label="State" defaultValue={task.state}>
                  {TASK_STATES.map((state) => (
                    <option key={state} value={state}>
                      {words.vocabulary.state[state]}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{words.vocabulary.priority[task.priority]}</dd>
            </div>
            {task.category !== null && (
              <div>
                <dt>Category</dt>
                <dd>
                  <CategoryBadge category={task.category} />
                </dd>
              </div>
            )}
            <div>
              <dt>Goal</dt>
              <dd>
                <a href="#detail">{closeGoal.title}</a>
              </dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>
                <PersonChip person={task.owner} />
              </dd>
            </div>
            <div>
              <dt>Workers</dt>
              <dd>
                <ul className="sc-worker-list">
                  {task.workers.map((worker) => (
                    <li key={worker.id}>
                      <PersonChip person={worker} />
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt>Written</dt>
              <dd>
                <Time iso={task.createdAt} />
              </dd>
            </div>
          </dl>
          <section className="sc-task-section" aria-label="Part of it">
            <h4 className="sc-section-title">Part of it</h4>
            <p className="sc-muted">No task is part of this one.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

// --- the page ----------------------------------------------------------------------------------

/** The agent a person acted through, in the words of the page's language. */
function ThroughAnAgent() {
  const words = useWords();
  return (
    <span>
      <PersonChip person={bob} />
      <span className="sc-feed-agent" title="desk">
        {words.feed.as("desk")}
      </span>
    </span>
  );
}

/**
 * The sections, in the catalogue's order. Each is a `Part` written at this level, its name
 * first, and nowhere else: the list at the page's side reads the names from here, and the check
 * reads them from this text.
 */
const sections: ReactElement<{ readonly children: ReactNode }> = (
  <>
    <Part
      name="button"
      classes="sc-button*"
      use="Anything pressed. Primary is the one act of a form or a page, secondary the act beside it, ghost an act among content, danger what takes something away; small in a row or a head."
    >
      <Specimen label="The variants" row>
        <Button variant="primary">Save the task</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="ghost">Remove</Button>
        <Button variant="danger">Delete the project</Button>
      </Specimen>
      <Specimen label="Small" row>
        <Button variant="primary" size="sm">
          Save the task
        </Button>
        <Button variant="secondary" size="sm">
          Cancel
        </Button>
        <Button variant="ghost" size="sm">
          Remove
        </Button>
        <Button variant="danger" size="sm">
          Delete the project
        </Button>
      </Specimen>
      <Specimen label="Not to be pressed now" row>
        <Button variant="primary" disabled>
          Save the task
        </Button>
        <Button variant="secondary" disabled>
          Cancel
        </Button>
        <Button variant="ghost" disabled>
          Remove
        </Button>
        <Button variant="danger" disabled>
          Delete the project
        </Button>
        <span className="sc-button sc-button-secondary sc-button-sm" aria-disabled="true">
          Previous
        </span>
      </Specimen>
      <Specimen label="A link that reads as a button" row>
        <LinkButton href="#button" variant="primary">
          Write a task
        </LinkButton>
        <LinkButton href="#button">Archive</LinkButton>
      </Specimen>
      <Specimen label="Copies a text, and says so once it has" row>
        <CopyButton text="console login --url https://console.acme.test" />
        <CopyButton text="console login --url https://console.acme.test" size="sm" />
      </Specimen>
    </Part>

    <Part
      name="input"
      classes="sc-input*, sc-textarea*"
      use="What is typed into or chosen from: a line, a select, a text area. Quiet is a fact changed in place, which reads as its value until the pointer or the focus is on it; a group puts a fixed word before a field."
    >
      <Specimen label="A line: filled, empty, not to be changed, and in its kinds">
        <div className="dev-fields">
          <input
            className="sc-input"
            aria-label="A title"
            defaultValue="Reconcile the three differences"
          />
          <input
            className="sc-input"
            aria-label="An empty title"
            placeholder="What is to be done"
          />
          <input
            className="sc-input"
            aria-label="A closed month"
            defaultValue="February"
            disabled
          />
          <input className="sc-input" type="search" aria-label="Words" placeholder="Words" />
          <input className="sc-input" type="date" aria-label="A day" defaultValue={TODAY} />
          <input className="sc-input" type="number" aria-label="A number" defaultValue={12} />
        </div>
      </Specimen>
      <Specimen label="A select">
        <div className="dev-fields">
          <select className="sc-input" aria-label="Priority" defaultValue="high">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <select className="sc-input" aria-label="A category, not to be changed" disabled>
            <option>Bookkeeping</option>
          </select>
        </div>
      </Specimen>
      <Specimen label="A text area">
        <textarea
          className="sc-input sc-textarea"
          aria-label="What the task is"
          rows={4}
          defaultValue={
            "The bank statement of the 27th was imported twice.\nTake the second import out, then match the card payment."
          }
        />
      </Specimen>
      <Specimen label="A file">
        <div className="dev-narrow">
          <input className="sc-input sc-input-file" type="file" aria-label="An image" />
        </div>
      </Specimen>
      <Specimen label="Quiet: a fact changed in place">
        <div className="dev-fields">
          <input
            className="sc-input sc-input-quiet"
            aria-label="A title, changed in place"
            defaultValue="Accountant"
          />
          <div>
            <select
              className="sc-input sc-input-quiet"
              aria-label="A role, changed in place"
              defaultValue="member"
            >
              <option value="admin">Administrator</option>
              <option value="member">Member</option>
            </select>
          </div>
        </div>
      </Specimen>
      <Specimen label="A group: a fixed word before the field">
        <div className="dev-narrow">
          <span className="sc-input-group">
            <span className="sc-input-prefix">skills.acme.test/</span>
            <input className="sc-input" aria-label="The skills' address" placeholder="ledger" />
          </span>
        </div>
      </Specimen>
    </Part>

    <Part
      name="form"
      classes="sc-form*, sc-field*, sc-check*, sc-member-form"
      use="A form: a field under its label with a hint, fields side by side, parts under headings, its buttons, what went wrong, a tick with its words, a small form on one line."
    >
      <Specimen label="A form in parts">
        <form className="sc-form" aria-label="A task" onSubmit={stay}>
          <section className="sc-form-part" aria-label="What">
            <h3 className="sc-section-title">What</h3>
            <label className="sc-field">
              <span className="sc-field-label">Title</span>
              <input className="sc-input" defaultValue="Check the March payroll" />
              <span className="sc-field-hint">A line that says what is done once it is done.</span>
            </label>
            <div className="sc-field-row">
              <label className="sc-field">
                <span className="sc-field-label">Priority</span>
                <select className="sc-input" defaultValue="normal">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="sc-field">
                <span className="sc-field-label">Begins</span>
                <input className="sc-input" type="date" defaultValue="2026-03-16" />
              </label>
              <label className="sc-field">
                <span className="sc-field-label">Due</span>
                <input className="sc-input" type="date" defaultValue="2026-03-13" />
              </label>
            </div>
          </section>
          <section className="sc-form-part" aria-label="Who">
            <div className="sc-section-head">
              <h3 className="sc-section-title">Who</h3>
              <Button size="sm">Suggest again</Button>
            </div>
            <label className="sc-check">
              <input type="checkbox" defaultChecked />
              Tell the workers when it changes
            </label>
            <ul className="sc-check-list" aria-label="Who may see it">
              <li>
                <label className="sc-check">
                  <input type="radio" name="dev-form-who" defaultChecked />
                  Everyone at Acme
                </label>
              </li>
              <li>
                <label className="sc-check">
                  <input type="radio" name="dev-form-who" />
                  The members of the project
                </label>
              </li>
              <li>
                <label className="sc-check">
                  <input type="radio" name="dev-form-who" disabled />
                  Nobody yet
                </label>
              </li>
            </ul>
          </section>
          <p className="sc-form-error" role="alert">
            The due day is before the day the work begins.
          </p>
          <div className="sc-form-actions">
            <Button type="submit" variant="primary">
              Save the task
            </Button>
            <Button>Cancel</Button>
          </div>
        </form>
      </Specimen>
      <Specimen label="A label beside its field">
        <div className="dev-row">
          <label className="sc-field sc-field-inline">
            <span className="sc-field-label">Role</span>
            <select className="sc-input" defaultValue="member">
              <option value="owner">Owner</option>
              <option value="member">Member</option>
            </select>
          </label>
        </div>
      </Specimen>
      <Specimen label="A small form on one line">
        <form className="sc-form sc-member-form" aria-label="A category" onSubmit={stay}>
          <div className="sc-field-row">
            <label className="sc-field">
              <span className="sc-field-label">Name</span>
              <input className="sc-input" defaultValue="Travel" />
            </label>
            <label className="sc-field">
              <span className="sc-field-label">Key</span>
              <input className="sc-input" defaultValue="travel" />
            </label>
            <label className="sc-field">
              <span className="sc-field-label">Colour</span>
              <select className="sc-input" defaultValue="teal">
                <option value="teal">Teal</option>
                <option value="pink">Pink</option>
              </select>
            </label>
            <div className="sc-form-actions">
              <Button type="submit" variant="primary">
                Add
              </Button>
            </div>
          </div>
        </form>
      </Specimen>
    </Part>

    <Part
      name="files"
      classes="sc-file*, sc-chosen*"
      use="Files to choose, and the ones chosen with the way to take each out."
    >
      <Specimen label="Chosen, and the way to choose more">
        <div className="sc-field">
          <span className="sc-field-label">Files</span>
          <ul className="sc-chosen-files" aria-label="Files">
            {[
              { name: "statement-february.pdf", size: 184_320 },
              { name: "differences.csv", size: 2_150 },
            ].map((file) => (
              <li key={file.name} className="sc-chosen-file">
                <span>{file.name}</span> <span className="sc-muted">{formatBytes(file.size)}</span>{" "}
                <Button variant="ghost" size="sm" aria-label={`Remove ${file.name}`}>
                  ×
                </Button>
              </li>
            ))}
          </ul>
          <div className="dev-row">
            <label className="sc-button sc-button-ghost sc-button-sm sc-file-choice">
              Choose files
              <input className="sc-file-input" type="file" multiple />
            </label>
            <label className="sc-button sc-button-secondary sc-file-choice">
              Attach a file
              <input className="sc-file-input" type="file" />
            </label>
          </div>
          <p className="sc-field-hint">Up to five files, each of 10 MB or less.</p>
        </div>
      </Specimen>
    </Part>

    <Part
      name="toggle"
      classes="sc-toggle*"
      use="One choice among a few, each a chip, the chosen one filled."
    >
      <Specimen label="Chosen, not chosen, and not to be changed">
        <fieldset className="sc-toggle-chips" aria-label="The days Acme works">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
            <label key={day} className="sc-toggle-chip">
              <input type="checkbox" defaultChecked={day !== "Wed"} />
              {day}
            </label>
          ))}
          <label className="sc-toggle-chip">
            <input type="checkbox" disabled />
            Sat
          </label>
          <label className="sc-toggle-chip">
            <input type="checkbox" defaultChecked disabled />
            Sun
          </label>
        </fieldset>
      </Specimen>
    </Part>

    <Part
      name="picker"
      classes="sc-picker*, sc-person-option*"
      use="One thing chosen out of a listing that is searched: a person, a project, a goal, a task. Quiet where it is a fact changed in place, add at the end of a row of chips."
    >
      <Pickers />
    </Part>

    <Part
      name="menu"
      classes="sc-menu*"
      use="What opens from a button over the page: the person's menu, a card's."
    >
      <Specimen label="At the header's end: press it, and it opens over the page">
        <HeaderBar>
          <div className="sc-header-inner">
            <div className="sc-header-end">
              <details className="sc-menu">
                <summary className="sc-menu-summary" aria-label="The menu of Alice Lindqvist">
                  <Avatar person={alice} size="sm" />
                  <span className="sc-person-login">Alice Lindqvist</span>
                  <Caret />
                </summary>
                <MenuPanel />
              </details>
            </div>
          </div>
        </HeaderBar>
      </Specimen>
      <Specimen label="The panel, open">
        <div className="sc-menu">
          <MenuPanel className="dev-static" />
        </div>
      </Specimen>
    </Part>

    <Part
      name="tabs"
      classes="sc-tab*, sc-tabs*, sc-subtabs*"
      use="The pages of a project, and the views of one page, the current one marked."
    >
      <Specimen label="The pages of a project, under the header: one current, one with a count, one too long, one that opens a list">
        <HeaderBar>
          <nav className="sc-tabs" aria-label="The pages of a project">
            <div className="sc-tabs-inner">
              <a className="sc-tab sc-tab-current" href="#tabs" aria-current="page">
                <span className="sc-tab-label">Board</span>
              </a>
              <a className="sc-tab" href="#tabs">
                <span className="sc-tab-label">Calendar</span>
              </a>
              <a className="sc-tab" href="#tabs">
                <span className="sc-tab-label">Decisions</span>
                <span className="sc-nav-count">3</span>
              </a>
              <a
                className="sc-tab"
                href="#tabs"
                title="The reports of the quarter, by account and by vendor"
              >
                <span className="sc-tab-label">
                  The reports of the quarter, by account and by vendor
                </span>
              </a>
              <div className="sc-tab-group">
                <button type="button" className="sc-tab sc-tab-summary" aria-expanded="false">
                  <span className="sc-tab-label">Plugins</span>
                  <Caret />
                </button>
              </div>
            </div>
          </nav>
        </HeaderBar>
      </Specimen>
      <Specimen label="The list a tab opens">
        <div className="sc-menu-panel sc-tab-group-panel dev-static">
          <div className="sc-menu-list">
            <a className="sc-menu-link sc-group-link" href="#tabs" aria-current="page">
              Leave
            </a>
            <a className="sc-menu-link sc-group-link" href="#tabs">
              Expenses
            </a>
          </div>
        </div>
      </Specimen>
      <Specimen label="The views of one page, each with how many it holds">
        <nav className="sc-subtabs" aria-label="The views of the people's page">
          <a className="sc-tab sc-tab-current" href="#tabs" aria-current="page">
            People
            <span className="sc-tab-count">6</span>
          </a>
          <a className="sc-tab" href="#tabs">
            Teams
            <span className="sc-tab-count">3</span>
          </a>
          <a className="sc-tab" href="#tabs">
            Agents
          </a>
        </nav>
      </Specimen>
    </Part>

    <Part
      name="pager"
      classes="sc-pager*, sc-show*"
      use={'A long list a page at a time: turned by pages, or grown by "show more".'}
    >
      <Pagers />
    </Part>

    <Part
      name="badge"
      classes="sc-badge*, sc-kind*"
      use="A state or a kind in a word. The tone is the meaning: neutral, accent, success, warning, point, danger. Nothing stands before its words but the dot of one that is live."
    >
      <Specimen label="The tones of a plain badge" row>
        <Badge tone="neutral">Private</Badge>
        <Badge tone="accent">Owner</Badge>
        <Badge tone="success">Connected</Badge>
        <Badge tone="warning">Expires soon</Badge>
        <Badge tone="point">Yours</Badge>
        <Badge tone="danger">Revoked</Badge>
        <RoleBadge role={alice.role} />
        <RoleBadge role={bob.role} />
      </Specimen>
      <Specimen label="The state of a task" row>
        {TASK_STATES.map((state) => (
          <StateBadge key={state} state={state} />
        ))}
      </Specimen>
      <Specimen label="The state of a goal, and of a run" row>
        {GOAL_STATES.map((state) => (
          <GoalStateBadge key={state} state={state} />
        ))}
        {RUN_STATUSES.map((status) => (
          <RunStatusBadge key={status} status={status} />
        ))}
      </Specimen>
      <Specimen label="A priority: low, high, urgent" row>
        <PriorityBadge priority="low" />
        <PriorityBadge priority="high" />
        <PriorityBadge priority="urgent" />
      </Specimen>
      <Specimen
        label="A due day: late, today, tomorrow, within the week, further off, and of a task that is over"
        row
      >
        <DueBadge dueOn="2026-03-06" state="in_progress" today={TODAY} />
        <DueBadge dueOn={TODAY} state="ready" today={TODAY} />
        <DueBadge dueOn="2026-03-13" state="ready" today={TODAY} />
        <DueBadge dueOn="2026-03-18" state="ready" today={TODAY} />
        <DueBadge dueOn="2026-03-27" state="ready" today={TODAY} />
        <DueBadge dueOn="2026-03-04" state="done" today={TODAY} />
      </Specimen>
      <Specimen label="A count" row>
        <Badge tone="warning" kind="count">
          2 decisions
        </Badge>
        <Badge tone="point" kind="count">
          12
        </Badge>
        <Badge tone="neutral" kind="count">
          0
        </Badge>
      </Specimen>
      <Specimen label="Live: at work this moment" row>
        <Badge tone="accent" kind="state" live>
          Running
        </Badge>
        <Badge tone="success" live>
          Online
        </Badge>
        <Badge tone="warning" live>
          Waiting
        </Badge>
      </Specimen>
      <Specimen label="What a member is, where it is no person" row>
        <KindMark person={mira} />
        <PersonChip person={mira} />
      </Specimen>
    </Part>

    <Part
      name="category"
      classes="sc-category-swatch, sc-category-<hue>"
      use="A colour that tells things apart: a category, a kind. The hue's class sets the fill, the line and the mark, which a badge, a bar or a dot reads. The only colours that are not tones."
    >
      <Specimen label="As a badge, in each hue" row>
        {categories.map((category) => (
          <CategoryBadge key={category.key} category={category} />
        ))}
      </Specimen>
      <Specimen label="As a swatch beside its name" row>
        {categories.map((category) => (
          <span key={category.key} className="dev-pair">
            <span
              className={cx("sc-category-swatch", `sc-category-${category.color}`)}
              aria-hidden="true"
            />
            {category.name}
          </span>
        ))}
      </Specimen>
      <Specimen label="As a project's mark" row>
        {categories.map((category) => (
          <ProjectMark
            key={category.key}
            project={{
              key: category.key,
              name: category.name,
              color: category.color,
              symbol: null,
            }}
          />
        ))}
      </Specimen>
    </Part>

    <Part
      name="chip"
      classes="sc-chip*, sc-chips*"
      use="A thing named among others in a row: a person, a team, an item, with the way to take it out. A row a person adds to and takes from is the chips."
    >
      <Specimen label="Read, taken out, and not to be changed" row>
        <Chip>Finance</Chip>
        <Chip onRemove={() => undefined} removeLabel="Remove: Finance">
          Finance
        </Chip>
        <Chip onRemove={() => undefined} removeLabel="Remove: Finance" disabled>
          Finance
        </Chip>
      </Specimen>
      <Specimen label="A person in a chip" row>
        <Chip>
          <PersonChip person={alice} />
        </Chip>
        <Chip onRemove={() => undefined} removeLabel="Remove: Mira">
          <PersonChip person={mira} />
        </Chip>
      </Specimen>
      <Specimen label="A name too long for its row">
        <div className="dev-narrow">
          <div className="sc-chips">
            <Chip onRemove={() => undefined}>
              The people who close the books of every month before the fifth working day
            </Chip>
          </div>
        </div>
      </Specimen>
      <Specimen label="A row added to and taken from">
        <TeamChips />
      </Specimen>
      <Specimen label="Items typed one by one">
        <div className="dev-narrow">
          <div className="sc-chips">
            <Chip onRemove={() => undefined}>invoices@acme.test</Chip>
            <Chip onRemove={() => undefined}>payroll@acme.test</Chip>
            <div className="sc-chip-input">
              <input className="sc-input" aria-label="An address" placeholder="Add one" />
              <Button size="sm">Add</Button>
            </div>
          </div>
        </div>
      </Specimen>
    </Part>

    <Part name="avatar" classes="sc-avatar*" use="A person's or an agent's picture, xs to xl.">
      <Specimen label="A person with no picture: the initial of the name" row>
        {SIZES.map((size) => (
          <Avatar key={size} person={alice} size={size} />
        ))}
      </Specimen>
      <Specimen label="A person's picture" row>
        {SIZES.map((size) => (
          <img key={size} className={cx("sc-avatar", `sc-avatar-${size}`)} src={PORTRAIT} alt="" />
        ))}
      </Specimen>
      <Specimen label="An agent account: drawn from its parts, a soft square" row>
        {SIZES.map((size) => (
          <Avatar key={size} person={mira} size={size} />
        ))}
        <Avatar person={juno} size="lg" />
      </Specimen>
    </Part>

    <Part
      name="person"
      classes="sc-person*, sc-people*"
      use="A person: by name in a line, as a row of a list, as a card with their facts, cards in a grid."
      ground="field"
    >
      <Specimen
        label="By name in a line: with a name, with a login alone, an agent account, and larger"
        row
      >
        <PersonChip person={alice} />
        <PersonChip person={carol} />
        <PersonChip person={mira} />
        <PersonChip person={bob} size="md" />
      </Specimen>
      <Specimen label="As a row of a list: the reader, one whose role is changed, one who is out">
        <ul className="sc-people">
          <li className="sc-person-row">
            <PersonChip person={alice} size="md" />
            <span className="sc-person-you">you</span>
            <span className="sc-person-name">
              alice
              <span className="sc-muted">
                {" "}
                since <Time iso={NOW} precision="day" />
              </span>
            </span>
            <Badge tone="accent">Owner</Badge>
          </li>
          <li className="sc-person-row">
            <PersonChip person={bob} size="md" />
            <span className="sc-person-name">
              bob
              <span className="sc-muted">
                {" "}
                since <Time iso={NOW} precision="day" />
              </span>
            </span>
            <label className="sc-field sc-field-inline">
              <span className="sc-visually-hidden">Role of Bob Arroyo</span>
              <select className="sc-input" defaultValue="member">
                <option value="owner">Owner</option>
                <option value="member">Member</option>
              </select>
            </label>
          </li>
          <li className="sc-person-row sc-person-row-out">
            <PersonChip person={dave} size="md" />
            <span className="sc-person-name sc-muted">
              dave ·{" "}
              <span className="sc-person-note">
                Left the organization <Time iso="2026-02-20T09:00:00.000Z" />
              </span>
            </span>
            <Badge tone="neutral">Deactivated</Badge>
          </li>
        </ul>
      </Specimen>
      <Specimen label="As cards in a grid: facts read, facts changed in place, an agent account, an account that is out">
        <PersonCards />
      </Specimen>
    </Part>

    <Part
      name="workers"
      classes="sc-workers*, sc-worker*"
      use="The people at work on one thing, as pictures side by side with a count of the rest."
    >
      <Specimen label="One, a few, and more than are shown" row>
        <Workers workers={[bob]} />
        <Workers workers={[bob, mira, carol]} />
        <Workers workers={[erin, bob, alice, mira, carol, juno]} />
      </Specimen>
      <Specimen label="Smallest, as on a day of the calendar" row>
        <Workers workers={[bob, mira]} size="xs" shown={2} />
        <Workers workers={[erin, bob, alice, mira]} size="xs" shown={2} />
      </Specimen>
      <Specimen label="By name, one under the other">
        <ul className="sc-worker-list">
          {[bob, mira, carol].map((worker) => (
            <li key={worker.id}>
              <PersonChip person={worker} />
            </li>
          ))}
        </ul>
      </Specimen>
    </Part>

    <Part
      name="mark"
      classes="sc-mark*"
      use="A project's mark: its image, or its symbol on its colour; sm, md, lg."
    >
      <Specimen label="The sizes: the first letter of the name on a colour chosen from the key" row>
        <ProjectMark project={ledger} size="sm" />
        <ProjectMark project={ledger} size="md" />
        <ProjectMark project={ledger} size="lg" />
      </Specimen>
      <Specimen label="A symbol and a colour of its own" row>
        <ProjectMark project={payrollProject} size="sm" />
        <ProjectMark project={payrollProject} size="md" />
        <ProjectMark project={payrollProject} size="lg" />
      </Specimen>
      <Specimen label="The project's own image" row>
        <ProjectMark project={ledger} size="sm" iconSrc={SEAL} />
        <ProjectMark project={ledger} size="md" iconSrc={SEAL} />
        <ProjectMark project={ledger} size="lg" iconSrc={SEAL} />
      </Specimen>
      <Specimen label="Before a name" row>
        <span>
          <ProjectMark project={ledger} size="sm" />
          Ledger
        </span>
      </Specimen>
    </Part>

    <Part
      name="eyebrow"
      classes="sc-eyebrow*"
      use="The small capitals over a group. The one label of that kind."
    >
      <Specimen label="Over a group">
        <div>
          <h3 className="sc-eyebrow">Tasks at work</h3>
          <p>Reconcile the three differences of the February close</p>
          <p>Fix the bank statement import that fails</p>
        </div>
      </Specimen>
    </Part>

    <Part
      name="progress"
      classes="sc-progress*"
      use="How much of something is done and at work, as a bar with its count."
    >
      <Specimen label="Some done and some at work, all done, none begun, and nothing to do">
        <div className="dev-fields">
          <ProgressBar counts={closeGoal.taskCounts} />
          <ProgressBar counts={counts({ done: 8 })} />
          <ProgressBar counts={counts({ idea: 1, ready: 3 })} />
          <ProgressBar counts={counts()} />
        </div>
      </Specimen>
      <Specimen label="The bar alone, where a row beside it says the figures">
        <div className="dev-narrow">
          <ProgressBar counts={closeGoal.taskCounts} words={false} />
        </div>
      </Specimen>
    </Part>

    <Part
      name="count"
      classes="sc-column-count, sc-nav-count"
      use="A number beside a title or a tab."
    >
      <Specimen label="Beside a title">
        <h3 className="sc-section-title">
          Late <span className="sc-column-count">3</span>
        </h3>
        <h3 className="sc-section-title">
          With no day yet <span className="sc-column-count">128</span>
        </h3>
      </Specimen>
      <Specimen label="Beside a tab: what waits" row>
        <a className="sc-tab" href="#count">
          <span className="sc-tab-label">Decisions</span>
          <span className="sc-nav-count">3</span>
        </a>
        <a className="sc-tab" href="#count">
          <span className="sc-tab-label">My work</span>
          <span className="sc-nav-count">24</span>
        </a>
      </Specimen>
    </Part>

    <Part
      name="text"
      classes="sc-muted, sc-lead, sc-time, sc-loading, sc-project-key, sc-card-number, sc-feed-agent, sc-visually-hidden"
      use="The tones of a line of text: quiet, the sentence under a title, a moment, a key or a number in the mono face, the agent a person acted through, and what only a screen reader is told."
    >
      <Specimen label="Quiet">
        <p className="sc-muted">Nothing more was written about this task.</p>
      </Specimen>
      <Specimen label="The sentence under a title">
        <p className="sc-lead">
          Everyone at Acme sees this project and may work in it. The members listed below are its
          owners.
        </p>
      </Specimen>
      <Specimen
        label="A moment: to the minute, the day alone, the hour of today, another day's hour; and a day"
        row
      >
        <Time iso={NOW} />
        <Time iso={NOW} precision="day" />
        <Time iso={NOW} precision="clock" against={NOW} />
        <Time iso="2026-03-02T08:15:00.000Z" precision="clock" against={NOW} />
        <Day day={TODAY} />
      </Specimen>
      <Specimen label="A key and a number, in the mono face" row>
        <code className="sc-project-key">LEDGER</code>
        <span className="sc-card-number">#12</span>
      </Specimen>
      <Specimen label="The agent a person acted through" row>
        <ThroughAnAgent />
      </Specimen>
      <Specimen label="Where a page waits">
        <div className="sc-loading dev-loading">
          <Spinner label="Loading" />
        </div>
      </Specimen>
      <Specimen label="What only a screen reader is told">
        <p>
          Three decisions
          <span className="sc-visually-hidden"> wait for an answer from Alice Lindqvist</span>{" "}
          <span className="sc-muted">(the rest of the sentence is said, not shown)</span>
        </p>
      </Specimen>
    </Part>

    <Part
      name="prose"
      classes="sc-prose*"
      use="What people and agents wrote, rendered: headings, lists, tables, code, pictures."
    >
      <Specimen label="A text with everything in it; a picture that did not come with it stays words">
        <Markdown
          source={WRITTEN_TEXT}
          fileSrc={(source) => (source === "figure.svg" ? FIGURE : undefined)}
        />
      </Specimen>
    </Part>

    <Part
      name="code"
      classes="sc-code*, sc-copyable*"
      use="A code or a command shown to be read or copied."
    >
      <Specimen label="Commands to read">
        <pre className="sc-code">
          npm install -g @skillcdn/console{"\n"}console login --url https://console.acme.test
          {"\n"}console use LEDGER
        </pre>
      </Specimen>
      <Specimen label="A text to copy, with the way to copy it in its corner">
        <div className="sc-copyable">
          <pre className="sc-code">
            Connect to the console at https://console.acme.test and work the board of the project
            LEDGER.
          </pre>
          <CopyButton
            text="Connect to the console at https://console.acme.test and work the board of the project LEDGER."
            size="sm"
          />
        </div>
      </Specimen>
      <Specimen label="A code typed in, and a code shown" row>
        <input className="sc-input sc-code-input" aria-label="The code" defaultValue="ABCD-EFGH" />
        <span>
          Your agent showed <code className="sc-code-shown">ABCD-EFGH</code>
        </span>
      </Specimen>
    </Part>

    <Part
      name="panel"
      classes="sc-panel*"
      use="A pane of the page: every section of a page is one."
      ground="field"
    >
      <Specimen label="A pane">
        <section className="sc-panel" aria-label="Members">
          <h3 className="sc-section-title">Members</h3>
          <p>Everyone at Acme sees this project and may work in it.</p>
        </section>
      </Specimen>
      <Specimen label="A pane that holds a form: as wide as a form is comfortable to fill in">
        <section className="sc-panel sc-panel-form" aria-label="A new goal">
          <form className="sc-form" aria-label="A new goal" onSubmit={stay}>
            <label className="sc-field">
              <span className="sc-field-label">Title</span>
              <input className="sc-input" defaultValue="The March close" />
            </label>
            <div className="sc-form-actions">
              <Button type="submit" variant="primary">
                Set the goal
              </Button>
            </div>
          </form>
        </section>
      </Specimen>
    </Part>

    <Part
      name="page"
      classes="sc-page*, sc-section*"
      use="A page's head, with its title, its lead and its actions, and a section's."
      ground="field"
    >
      <Specimen label="A page's head: the title, a word about it, the ways the page offers">
        <div className="sc-page-head">
          <div className="sc-page-heading">
            <h3 className="sc-page-title">Ledger</h3>
            <p className="sc-page-lead">
              The books of Acme: every month closed by the fifth working day of the next.
            </p>
          </div>
          <div className="sc-page-actions">
            <LinkButton href="#page">Archive</LinkButton>
            <LinkButton href="#page" variant="primary">
              Write a task
            </LinkButton>
          </div>
        </div>
      </Specimen>
      <Specimen label="A head with one way alone, and one with none">
        <div className="sc-page-head">
          <h3 className="sc-page-title">Calendar</h3>
          <LinkButton href="#page" variant="primary">
            Write a task
          </LinkButton>
        </div>
        <div className="sc-page-head">
          <h3 className="sc-page-title">Settings</h3>
        </div>
      </Specimen>
      <Specimen label="The pages of a plugin, a row under the header's tabs">
        <div className="dev-flush">
          <nav className="sc-page-tabs" aria-label="The pages of a plugin">
            <a className="sc-tab sc-tab-current" href="#page" aria-current="page">
              Requests
            </a>
            <a className="sc-tab" href="#page">
              Balances
            </a>
            <a className="sc-tab" href="#page">
              Settings
            </a>
          </nav>
        </div>
      </Specimen>
      <Specimen label="A section's title, and one with something beside it">
        <section className="sc-panel" aria-label="The project's rules">
          <h3 className="sc-section-title">The project's rules</h3>
          <p className="sc-muted">No rules were written for this project yet.</p>
        </section>
        <section className="sc-panel" aria-label="The workspace's rules">
          <div className="sc-section-head">
            <h3 className="sc-section-title">The workspace's rules</h3>
            <a className="sc-muted" href="#page">
              On the workspace's settings
            </a>
          </div>
          <p className="sc-muted">An agent asks before it deletes anything.</p>
        </section>
      </Specimen>
    </Part>

    <Part
      name="facts"
      classes="sc-facts*"
      use="Facts as names and values: in a pane's column, bare, on one line."
      ground="field"
    >
      <Specimen label="A pane of its own, each fact under its name">
        <dl className="sc-facts">
          <div>
            <dt>State</dt>
            <dd>
              <StateBadge state="in_progress" />
            </dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>High</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>
              <PersonChip person={alice} />
            </dd>
          </div>
          <div>
            <dt>Due</dt>
            <dd>
              <Day day="2026-03-13" />
            </dd>
          </div>
          <div className="sc-facts-wide">
            <dt>Description</dt>
            <dd>The close of February, with the three differences the ledger still shows.</dd>
          </div>
        </dl>
      </Specimen>
      <Specimen label="Bare, inside a pane: a row per fact, the name beside the value">
        <section className="sc-panel" aria-label="The project">
          <dl className="sc-facts sc-facts-plain">
            <div>
              <dt>Name</dt>
              <dd>Ledger</dd>
            </div>
            <div>
              <dt>Key</dt>
              <dd>
                <code className="sc-project-key">LEDGER</code>
              </dd>
            </div>
            <div>
              <dt>Who is a member</dt>
              <dd>Everyone at Acme</dd>
            </div>
            <div>
              <dt>Mark</dt>
              <dd>
                <ProjectMark project={ledger} size="sm" />
              </dd>
            </div>
            <div className="sc-facts-wide">
              <dt>Description</dt>
              <dd>The books of Acme: every month closed by the fifth working day of the next.</dd>
            </div>
          </dl>
        </section>
      </Specimen>
      <Specimen label="On one line, a hairline between them">
        <dl className="sc-facts-row">
          <div>
            <dt>State</dt>
            <dd>
              <select className="sc-input" aria-label="State" defaultValue="active">
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="done">Done</option>
              </select>
            </dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>
              {closeGoal.category !== null && <CategoryBadge category={closeGoal.category} />}
            </dd>
          </div>
          <div>
            <dt>Begins</dt>
            <dd>
              <Day day="2026-03-02" />
            </dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>
              <span className="sc-muted">No day yet</span>
            </dd>
          </div>
        </dl>
      </Specimen>
    </Part>

    <Part
      name="callout"
      classes="sc-callout*"
      use="A note that must be read: plain, a warning, a danger."
    >
      <Specimen label="Plain, with a title">
        <Callout title="An agent connects with a code">
          Tell your agent the address of this console. It shows a code, and you approve it here.
        </Callout>
      </Specimen>
      <Specimen label="A warning, with something to do">
        <Callout
          tone="warning"
          title="This project has no skills yet"
          action={<LinkButton href="#callout">Add them</LinkButton>}
        >
          <p>
            An agent working here reads the organization's skills until the project has its own.
          </p>
          <p>Whoever owns the project sets their address.</p>
        </Callout>
      </Specimen>
      <Specimen label="A danger, in a line">
        <Callout tone="danger">
          The task was not saved: its due day is before the day the work begins.
        </Callout>
      </Specimen>
    </Part>

    <Part
      name="empty"
      classes="sc-empty*"
      use="Where there is nothing yet: what would be here and the way to make the first."
    >
      <Specimen label="With the way to the first">
        <EmptyState
          title="No tasks yet"
          body="A task says what is to be done, in a line. Write the first, or have your agent write it."
          action={
            <LinkButton href="#empty" variant="primary">
              Write a task
            </LinkButton>
          }
        />
      </Specimen>
      <Specimen label="In a line">
        <EmptyState title="Nothing is due this month" />
      </Specimen>
    </Part>

    <Part name="spinner" classes="sc-spinner*" use="Something is on its way.">
      <Specimen label="Turning" row>
        <Spinner label="Loading" />
        <span className="sc-muted">Reading the rules</span>
      </Specimen>
    </Part>

    <Part
      name="steps"
      classes="sc-steps*, sc-step*"
      use="Steps done in order, each with its mark, the next one pointed out."
    >
      <Specimen label="One done, the next to do, and one after it">
        <ol className="sc-steps" aria-label="Setting Acme up">
          <li className="sc-step sc-step-done">
            <span className="sc-step-mark" aria-hidden="true">
              1
            </span>
            <div className="sc-step-what">
              <span className="sc-step-title">
                Name the workspace
                <Badge tone="success">Done</Badge>
              </span>
              <p className="sc-step-body">It is called Acme on every page.</p>
            </div>
          </li>
          <li className="sc-step sc-step-next" aria-current="step">
            <span className="sc-step-mark" aria-hidden="true">
              2
            </span>
            <div className="sc-step-what">
              <span className="sc-step-title">Connect your agent</span>
              <p className="sc-step-body">
                Say this to the agent you work with. It shows a code, and you approve it here.
              </p>
              <pre className="sc-code">Connect to the console at https://console.acme.test</pre>
            </div>
          </li>
          <li className="sc-step">
            <span className="sc-step-mark" aria-hidden="true">
              3
            </span>
            <div className="sc-step-what">
              <span className="sc-step-title">Write the first task</span>
              <p className="sc-step-body">A line that says what is done once it is done.</p>
            </div>
          </li>
        </ol>
      </Specimen>
    </Part>

    <Part
      name="settings"
      classes="sc-settings*"
      use="Settings as rows: a label, its control, a hint."
    >
      <Specimen label="Read: a row per setting, its name beside its value">
        <dl className="sc-settings-list">
          <div className="sc-settings-item">
            <dt>Name</dt>
            <dd>Acme</dd>
          </div>
          <div className="sc-settings-item">
            <dt>Console</dt>
            <dd>
              0.5.1
              <span className="sc-settings-note">takes the command from 0.5.0 on</span>
            </dd>
          </div>
          <div className="sc-settings-item">
            <dt>Weeks begin on</dt>
            <dd>Monday</dd>
          </div>
        </dl>
      </Specimen>
      <Specimen label="Changed: the name and the hint beside a control, a group under its title, the buttons under a line">
        <form className="sc-form sc-settings-form" aria-label="Settings" onSubmit={stay}>
          <div className="sc-settings-row">
            <div>
              <label className="sc-settings-label" htmlFor="dev-settings-name">
                Name *
              </label>
              <p className="sc-settings-hint">What the workspace is called on every page.</p>
            </div>
            <div className="sc-settings-control">
              <input id="dev-settings-name" className="sc-input" defaultValue="Acme" />
            </div>
          </div>
          <div className="sc-settings-row">
            <div>
              <label className="sc-settings-label" htmlFor="dev-settings-week">
                Weeks begin on
              </label>
              <p className="sc-settings-hint">The first day of a week on every calendar.</p>
            </div>
            <div className="sc-settings-control">
              <select id="dev-settings-week" className="sc-input" defaultValue="monday">
                <option value="monday">Monday</option>
                <option value="sunday">Sunday</option>
              </select>
            </div>
          </div>
          <section className="sc-settings-group" aria-label="Reminders">
            <h3 className="sc-settings-group-title">Reminders</h3>
            <p className="sc-settings-hint">What Acme is told, and on which days.</p>
            <div className="sc-settings-row">
              <div>
                <p className="sc-settings-label">Days</p>
                <p className="sc-settings-hint">A reminder is sent on these days alone.</p>
              </div>
              <div className="sc-settings-control">
                <fieldset className="sc-toggle-chips" aria-label="Days">
                  {["Mon", "Wed", "Fri"].map((day) => (
                    <label key={day} className="sc-toggle-chip">
                      <input type="checkbox" defaultChecked={day !== "Wed"} />
                      {day}
                    </label>
                  ))}
                </fieldset>
              </div>
            </div>
            <div className="sc-settings-row">
              <div>
                <p className="sc-settings-label">The report of the week</p>
                <p className="sc-settings-hint">Everything the workspace did, as a file.</p>
              </div>
              <div className="sc-settings-control">
                <LinkButton href="#settings">Take the report</LinkButton>
              </div>
            </div>
          </section>
          <div className="sc-form-actions">
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </Specimen>
    </Part>

    <Part
      name="rows"
      classes="sc-task-row*, sc-task-rows*"
      use="A list as rows, each a link with a title and what is said of it at the end."
    >
      <Specimen label="Tasks, each with its project, its state and what is said of it">
        <TaskList
          tasks={tasks.slice(0, 5)}
          taskHref={() => "#rows"}
          projectOf={() => "Ledger"}
          today={TODAY}
          label="The tasks of the week"
          showState
        />
      </Specimen>
      <Specimen label="Tasks of one project, grouped by their state elsewhere">
        <TaskList
          tasks={tasks.slice(5, 8)}
          taskHref={() => "#rows"}
          today={TODAY}
          label="Tasks with a day further off"
        />
      </Specimen>
    </Part>

    <Part
      name="detail"
      classes="sc-task-header, sc-task-title, sc-task-badges, sc-task-actions, sc-task-main, sc-task-body, sc-task-aside, sc-task-section"
      use="A page about one thing: its head with the title, the badges and the actions, a main column and an aside. A task, a goal and a document are laid out by it."
      ground="field"
    >
      <Specimen label="A task: the head, the text in a column for reading, the facts beside it">
        <Detail />
      </Specimen>
    </Part>

    <Part
      name="calendar"
      classes="sc-calendar*"
      use="A month as a grid of days, with bars across days, dots, a legend and a head."
      ground="field"
    >
      <Specimen label="A month: bars across days and weeks, tasks on their day, goals on their target, a late task, a day with more than it shows, today; press a day's number for its list">
        <Calendar
          tasks={tasks}
          month={MONTH}
          today={TODAY}
          categories={categories}
          goals={goals}
          taskHref={() => "#calendar"}
          goalHref={() => "#calendar"}
          monthHref={() => "#calendar"}
        />
      </Specimen>
    </Part>

    <Part
      name="crumbs"
      classes="sc-crumb*, sc-doc-crumbs*"
      use="The way down to where the page is, each step a link."
    >
      <Specimen label="In the header, after the brand: the workspace, then the project">
        <HeaderBar>
          <div className="sc-header-inner">
            <a className="sc-brand" href="#crumbs" aria-label="Acme">
              <img className="sc-brand-symbol" src={symbol} alt="" />
              <img className="sc-brand-wordmark" src={wordmark} alt="" />
            </a>
            <span className="sc-crumb">
              <span className="sc-crumb-separator" aria-hidden="true">
                /
              </span>
              <a className="sc-crumb-link" href="#crumbs">
                Acme
              </a>
            </span>
            <span className="sc-crumb">
              <span className="sc-crumb-separator" aria-hidden="true">
                /
              </span>
              <a className="sc-crumb-link" href="#crumbs">
                <ProjectMark project={ledger} size="sm" />
                Ledger
              </a>
            </span>
          </div>
        </HeaderBar>
      </Specimen>
      <Specimen label="The folders above a document; and with the last a link too">
        <DocumentCrumbs path="finance/close/february" folderHref={() => "#crumbs"} />
        <DocumentCrumbs path="finance/close/february" folderHref={() => "#crumbs"} last />
      </Specimen>
    </Part>

    <Part name="links" classes="sc-link*" use="Links as a list, or one with what it leads to.">
      <Specimen label="As a list, each with what is said of it">
        <ul className="sc-link-list">
          <li>
            <a href="#links">The close in the ledger</a>
          </li>
          <li>
            <a href="#links">statement-february.pdf</a>{" "}
            <span className="sc-muted">{formatBytes(184_320)}, by </span>
            <PersonChip person={bob} />
          </li>
        </ul>
      </Specimen>
      <Specimen label="One being written: where it leads, what it is called, the way to take it out">
        <div className="sc-link-row">
          <input
            className="sc-input"
            type="url"
            aria-label="Where the link leads"
            placeholder="https://"
          />
          <input className="sc-input" aria-label="What it is called" placeholder="What it is" />
          <Button variant="ghost" size="sm">
            Remove
          </Button>
        </div>
      </Specimen>
    </Part>

    <Part
      name="filters"
      classes="sc-filters*"
      use="What narrows a page: a row of choices with the count of what is left."
      ground="field"
    >
      <Specimen label="The board's: words, a category, a goal, a person, what is left, and the way back to everything">
        <Filters />
      </Specimen>
    </Part>

    <Part
      name="frame"
      classes="sc-plugin-frame*"
      use="Where a plugin's page or widget is shown: the box, and the frame in it."
    >
      <Specimen label="The box, as tall as the plugin's page says; a stand-in where the frame is">
        <div className="sc-plugin-frame-box dev-frame">
          <div className="sc-plugin-frame">
            <EmptyState
              title="A plugin's page"
              body="The plugin's own document is drawn here, in a frame of the box's size."
            />
          </div>
        </div>
      </Specimen>
      <Specimen label="Until the page has drawn">
        <div className="sc-plugin-frame-box sc-plugin-frame-loading dev-frame">
          <div className="sc-plugin-frame" />
          <div className="sc-plugin-frame-wait">
            <Spinner label="Loading" />
          </div>
        </div>
      </Specimen>
      <Specimen label="With nothing to show">
        <p className="sc-plugin-frame-unavailable">This can't be shown right now.</p>
      </Specimen>
    </Part>
  </>
);

/** The names of the sections, read from the sections themselves: the list never names a part the page lacks. */
const names: readonly string[] = Children.toArray(sections.props.children).flatMap((child) =>
  isValidElement<PartProps>(child) && child.type === Part ? [child.props.name] : [],
);

function PartsPage() {
  const korean = new URLSearchParams(window.location.search).get("lang") === KOREAN.tag;
  const pack = korean ? KOREAN : ENGLISH;
  const other = korean ? ENGLISH : KOREAN;
  // The stylesheet reads the page's language from the document (a label's lift, the tracking).
  document.documentElement.lang = pack.tag;
  const here = window.location.pathname;
  return (
    <LanguageContext.Provider value={pack}>
      <div className="sc-shell">
        <main className="sc-main">
          <div className="sc-page-head">
            <div className="sc-page-heading">
              <h1 className="sc-page-title">Parts</h1>
              <p className="sc-page-lead">
                The tokens and every part of the console's pages, each by itself.
              </p>
            </div>
            <div className="sc-page-actions">
              <a
                className="sc-button sc-button-secondary"
                href={korean ? here : `${here}?lang=${KOREAN.tag}`}
                lang={other.tag}
              >
                {other.label}
              </a>
            </div>
          </div>
          <div className="dev-page">
            <nav className="sc-panel dev-index" aria-label="The parts">
              <div className="sc-menu">
                <div className="sc-menu-list dev-index-list">
                  {["tokens", ...names].map((name) => (
                    <a key={name} className="sc-menu-link" href={`#${name}`}>
                      {name}
                    </a>
                  ))}
                </div>
              </div>
            </nav>
            <div className="dev-sections">
              <Tokens />
              {sections}
            </div>
          </div>
        </main>
      </div>
    </LanguageContext.Provider>
  );
}

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the page has no #root element");
}
createRoot(container).render(
  <StrictMode>
    <PartsPage />
  </StrictMode>,
);
