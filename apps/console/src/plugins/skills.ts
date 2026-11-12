import { type Address, LOCAL_HOST_KEY } from "@skillcdn/core";
import { createDirectorySource } from "../adapters/directory-packs.js";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { Skills } from "../skills.js";
import type { Plugins } from "./registry.js";

// A plugin's skills as a pack of its own (docs/specs/plugins.md, "REST"): the plugin's package,
// with `SKILLCDN.md` at its root and its skills under the directory the manifest names, read
// from the console's machine as any local pack is (ADR-0031), at the address
// `/local/plugins/<key>`, and answered through the reads a project's pack has. Nothing of
// the package is executed to read it, and the address means something on this console alone.

/** The owner every plugin's pack is filed under, in the address `/local/plugins/<key>`. */
export const PLUGIN_PACK_OWNER = "plugins";

/** The address a plugin's skills are read at. */
export function pluginSkillsAddress(key: string): string {
  return `/${LOCAL_HOST_KEY}/${PLUGIN_PACK_OWNER}/${key}`;
}

/** The reads of the plugins' packs: each located at its package by the registry, read as a directory. */
export function createPluginSkills(options: {
  readonly plugins: Plugins;
  readonly clock: Clock;
  readonly logger: Logger;
}): Skills {
  const { plugins, clock, logger } = options;
  const directory = createDirectorySource({
    root: ".",
    locate: (address: Address) =>
      address.owner === PLUGIN_PACK_OWNER ? plugins.skillsRootOf(address.repo) : undefined,
    clock,
    logger,
  });
  return new Skills({
    config: { source: "", address: undefined },
    deployment: { open: () => undefined },
    directory,
    clock,
    logger,
  });
}
