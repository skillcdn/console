import type { Boundary, Driver, Service, Spawn, WakeSource } from "./types.js";

// The runner's four registries (ADR-0085): the modules it knows by name, a kind each. What a
// `runner.json` names is looked up here and nowhere else, so that a name is a module the package
// ships or one a console of one's own registered, never a path to load.

/** The modules of one kind, by name. */
export interface Registry<T> {
  /** Adds a module under its name; a name taken already is an error of whoever registers. */
  register(name: string, module: T): void;
  get(name: string): T | undefined;
  /** The names registered, in order of the alphabet. */
  names(): readonly string[];
}

export function createRegistry<T>(kind: string): Registry<T> {
  const modules = new Map<string, T>();
  return {
    register(name, module) {
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) {
        throw new Error(
          `a ${kind} is registered under a name in small letters, digits and hyphens`,
        );
      }
      if (modules.has(name)) {
        throw new Error(`a ${kind} called ${name} is registered already`);
      }
      modules.set(name, module);
    },
    get: (name) => modules.get(name),
    names: () => [...modules.keys()].sort(),
  };
}

/** What a driver is made with: how it starts its product's process. */
export interface DriverHost {
  readonly spawn: Spawn;
  /** The desk: where the product is asked what it is, and where it works. */
  readonly cwd: string;
  /** The product's binary, where the machine names another than the driver's own. */
  readonly command?: string | undefined;
  /** The ids a driver writes its messages under, where a test wants to know them; random otherwise. */
  readonly uuid?: (() => string) | undefined;
}

export interface RunnerModules {
  readonly drivers: Registry<(host: DriverHost) => Driver>;
  readonly wakeSources: Registry<WakeSource>;
  readonly services: Registry<Service>;
  readonly boundaries: Registry<Boundary>;
}

/** Four empty registries, for whoever fills them: the package's own, or a console of one's own. */
export function createRunnerModules(): RunnerModules {
  return {
    drivers: createRegistry("driver"),
    wakeSources: createRegistry("wake source"),
    services: createRegistry("service"),
    boundaries: createRegistry("boundary"),
  };
}
