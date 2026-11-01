// What the migrate role does for the plugins (docs/specs/plugins.md, "Lifecycle"): before the api
// and worker roles start on a new image, every enabled plugin whose records are behind its
// manifest's `dataVersion` runs its `upgrades` in order, in a host of its own; each step brings
// the install one version on and leaves its event. A step that fails stops that plugin's
// upgrades, with a `plugin.failed` event; the others go on.
import { join } from "node:path";
import { PLUGIN_LIFECYCLE_MS } from "@skillcdn/console/plugin";
import type { Database } from "../db/client.js";
import { listInstalls, recordPluginFailure, upgradeInstall } from "../db/queries/plugins.js";
import type { WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import type { Discovery } from "./discovery.js";
import type { PluginHost } from "./host.js";
import type { PluginSqlService } from "./sql.js";

export interface UpgradeOptions {
  readonly database: Database;
  readonly workspace: WorkspaceRecord;
  readonly host: PluginHost;
  readonly discovery: Discovery;
  readonly memoryMb: number;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The schemas plugins have of their own; their migrations are applied before the upgrades. None where left out. */
  readonly sql?: PluginSqlService | undefined;
}

/** Runs the pending upgrades of every enabled plugin; answers how many steps ran. */
export async function runPluginUpgrades(options: UpgradeOptions): Promise<number> {
  const { database, workspace, host, discovery, logger, clock } = options;
  const installs = await listInstalls(database, workspace.id);
  let steps = 0;
  for (const install of installs) {
    if (install.state !== "enabled") {
      continue;
    }
    const plugin = discovery.plugins.find((candidate) => candidate.key === install.key);
    if (plugin === undefined) {
      continue;
    }
    if (install.consent.includes("storage:sql") && options.sql !== undefined) {
      try {
        await options.sql.provision(plugin.key);
        if (plugin.manifest.migrations !== undefined) {
          const applied = await options.sql.applyMigrations(
            plugin.key,
            join(plugin.dir, plugin.manifest.migrations),
          );
          if (applied > 0) {
            logger.info({ plugin: plugin.key, applied }, "the plugin's migrations were applied");
          }
        }
      } catch (error) {
        const problem = `the plugin's schema or migrations failed: ${error instanceof Error ? error.message : String(error)}`;
        logger.error({ plugin: plugin.key }, problem);
        await recordPluginFailure(database, {
          workspaceId: workspace.id,
          key: plugin.key,
          projectId: install.boardProjectId,
          problem,
          now: clock.now(),
        });
        continue;
      }
    }
    const target = plugin.manifest.dataVersion;
    if (install.dataVersion >= target && install.version === plugin.version) {
      continue;
    }
    if (install.dataVersion > target) {
      const problem = `the records are at data version ${install.dataVersion}, newer than the code's ${target}`;
      logger.error({ plugin: plugin.key }, problem);
      await recordPluginFailure(database, {
        workspaceId: workspace.id,
        key: plugin.key,
        projectId: install.boardProjectId,
        problem,
        now: clock.now(),
      });
      continue;
    }
    const loaded = await host.load({
      key: plugin.key,
      server: join(plugin.dir, plugin.manifest.server),
      version: plugin.version,
      memoryMb: options.memoryMb,
    });
    if (!loaded.ok) {
      const problem = `the server module did not load for its upgrades: ${loaded.error}`;
      logger.error({ plugin: plugin.key, problems: loaded.problems }, problem);
      await recordPluginFailure(database, {
        workspaceId: workspace.id,
        key: plugin.key,
        projectId: install.boardProjectId,
        problem,
        now: clock.now(),
      });
      continue;
    }
    let version = install.dataVersion;
    let failed = false;
    for (const upgrade of loaded.description.upgrades) {
      if (upgrade.to <= version) {
        continue;
      }
      const result = await host.call(plugin.key, {
        kind: "upgrade",
        name: String(upgrade.to),
        payload: null,
        info: {
          key: plugin.key,
          version: plugin.version,
          dataVersion: version,
          settings: install.settings,
          board: null,
          projects: install.projects === "all" ? "all" : [...install.projects],
        },
        caller: { kind: "console", roles: Object.keys(plugin.manifest.roles), project: null },
        language: "en",
        timeoutMs: PLUGIN_LIFECYCLE_MS,
      });
      if (!result.ok) {
        const problem = `the upgrade to ${upgrade.to} failed: ${result.error.code}: ${result.error.message}`;
        logger.error({ plugin: plugin.key }, problem);
        await recordPluginFailure(database, {
          workspaceId: workspace.id,
          key: plugin.key,
          projectId: install.boardProjectId,
          problem,
          now: clock.now(),
        });
        failed = true;
        break;
      }
      version = upgrade.to;
      steps += 1;
      await upgradeInstall(database, {
        workspaceId: workspace.id,
        key: plugin.key,
        version: plugin.version,
        dataVersion: version,
        now: clock.now(),
      });
      logger.info({ plugin: plugin.key, dataVersion: version }, "plugin upgraded");
    }
    if (!failed && install.version !== plugin.version && version === install.dataVersion) {
      // A new version of the code with the same data version: the install says which code runs.
      await upgradeInstall(database, {
        workspaceId: workspace.id,
        key: plugin.key,
        version: plugin.version,
        dataVersion: version,
        now: clock.now(),
      });
    }
    host.unload(plugin.key);
  }
  return steps;
}
