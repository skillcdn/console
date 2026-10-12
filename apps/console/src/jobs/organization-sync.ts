import type { Database } from "../db/client.js";
import { syncOrganization } from "../db/queries/people.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { ProviderError } from "../ports/identity-provider.js";
import type { OrganizationDirectory } from "../ports/organization.js";

/**
 * Keeps the people the organization let in as the organization has them (ADR-0022): read whole
 * on a schedule, those who left are deactivated and those who returned reactivated, by the
 * account's id, so that a rename changes nothing. The worker runs it, and so does the `api`
 * role when told to carry the worker's work. A pass that cannot read the organization, or reads
 * nobody, changes nothing and is the next one's work; one pass runs at a time.
 */
export class OrganizationSync {
  readonly #database: Database;
  readonly #organization: OrganizationDirectory;
  readonly #workspaceId: () => Promise<string>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly database: Database;
    readonly organization: OrganizationDirectory;
    readonly workspaceId: () => Promise<string>;
    readonly clock: Clock;
    readonly logger: Logger;
  }) {
    this.#database = options.database;
    this.#organization = options.organization;
    this.#workspaceId = options.workspaceId;
    this.#clock = options.clock;
    this.#logger = options.logger;
  }

  /** One pass. Resolves when it is done, or given up on. */
  sync(): Promise<void> {
    this.#running = this.#running.then(async () => {
      const organization = this.#organization.name;
      try {
        const members = await this.#organization.listMembers();
        if (members.length === 0) {
          // An organization has its owners at least: nobody is a reading gone wrong, not an emptying.
          this.#logger.warn({ organization }, "the organization listed nobody; nothing changed");
          return;
        }
        const changed = await syncOrganization(this.#database, {
          workspaceId: await this.#workspaceId(),
          host: this.#organization.host,
          members,
          now: this.#clock.now(),
        });
        this.#logger.info(
          {
            organization,
            members: members.length,
            deactivated: changed.deactivated.length,
            reactivated: changed.reactivated.length,
          },
          "the organization was read",
        );
      } catch (error) {
        this.#logger.warn(
          {
            err: error,
            organization,
            ...(error instanceof ProviderError ? { kind: error.kind } : {}),
          },
          "the organization could not be read; nothing changed",
        );
      }
    });
    return this.#running;
  }

  start(intervalMs: number): void {
    if (this.#timer === undefined) {
      this.#timer = setInterval(() => void this.sync(), intervalMs);
      this.#timer.unref();
    }
  }

  /** Stops the timer and waits for a pass that is under way. */
  async close(): Promise<void> {
    clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }
}
