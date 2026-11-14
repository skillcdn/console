// The boards a front page shows at a glance (ADR-0105), each read in one request (ADR-0107):
// which are read, when they are read again, and what becomes of an answer that comes late or
// not at all. Pure: it is given the way to read one and the way to wait, so that the
// composition's hook is a few lines and a test needs no page.

/** How long after a read that failed the next is tried, doubling from the first to the longest. */
export const GLANCE_RETRY_MS = 3_000;
export const GLANCE_RETRY_MAX_MS = 60_000;

export interface GlanceReaderOptions<Project extends { readonly id: string }, Glance> {
  /** Reads one project's glance. */
  readonly read: (project: Project) => Promise<Glance>;
  /** Takes a glance that was read, by the project's id. */
  readonly store: (projectId: string, glance: Glance) => void;
  /**
   * Whether a read that failed is worth another: not one the console refused, which it would
   * refuse again. Left out, every failure is.
   */
  readonly again?: ((failure: unknown) => boolean) | undefined;
  /** Runs something later and answers the way to call it off; `setTimeout`, left out. */
  readonly later?: ((run: () => void, ms: number) => () => void) | undefined;
}

export interface GlanceReader<Project> {
  /**
   * The projects shown at a glance now, none where no tile is: each is read once for a reading,
   * whatever is asked again while it is.
   */
  want(projects: readonly Project[]): void;
  /** A new reading: every project shown at a glance is read again, and what was on its way is dropped. */
  renew(): void;
  /** Ends it: nothing is stored after, and nothing is tried again. */
  stop(): void;
}

const soon = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/**
 * Reads the glances a front page shows. A project is read once for each reading; an answer is
 * kept only if it is still the reading it was asked for, so that a slow one never writes over a
 * newer one; and a read that failed is tried again, a little later each time, for as long as the
 * project is shown at a glance, so that one bad moment does not leave a tile empty for good.
 */
export function createGlanceReader<Project extends { readonly id: string }, Glance>(
  options: GlanceReaderOptions<Project, Glance>,
): GlanceReader<Project> {
  const later = options.later ?? soon;
  const again = options.again ?? (() => true);
  let reading = 0;
  let stopped = false;
  let wanted = new Map<string, Project>();
  /** Each project by the reading it was last asked for. */
  const asked = new Map<string, number>();
  /** The tries that wait, by project, each with the way to call it off. */
  const waiting = new Map<string, () => void>();

  const ask = (project: Project, attempt: number): void => {
    const mine = reading;
    asked.set(project.id, mine);
    const current = () => !stopped && asked.get(project.id) === mine;
    options.read(project).then(
      (glance) => {
        if (current()) {
          options.store(project.id, glance);
        }
      },
      (failure) => {
        if (!current()) {
          return;
        }
        if (!wanted.has(project.id) || !again(failure)) {
          // Asked again when it is shown at a glance anew, or at the next reading.
          asked.delete(project.id);
          return;
        }
        const wait = Math.min(GLANCE_RETRY_MS * 2 ** attempt, GLANCE_RETRY_MAX_MS);
        waiting.set(
          project.id,
          later(() => {
            waiting.delete(project.id);
            if (!current()) {
              return;
            }
            const shown = wanted.get(project.id);
            if (shown === undefined) {
              asked.delete(project.id);
              return;
            }
            ask(shown, attempt + 1);
          }, wait),
        );
      },
    );
  };

  return {
    want(projects) {
      wanted = new Map(projects.map((project) => [project.id, project]));
      if (stopped) {
        return;
      }
      for (const project of projects) {
        if (asked.get(project.id) !== reading) {
          ask(project, 0);
        }
      }
    },
    renew() {
      if (stopped) {
        return;
      }
      reading += 1;
      for (const cancel of waiting.values()) {
        cancel();
      }
      waiting.clear();
      for (const project of wanted.values()) {
        ask(project, 0);
      }
    },
    stop() {
      stopped = true;
      for (const cancel of waiting.values()) {
        cancel();
      }
      waiting.clear();
    },
  };
}
