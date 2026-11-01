// For a plugin that chooses React: the connection as a hook. One connection per document, made
// on first use and shared; the component renders nothing of the console's until `frame` is there.
import { useEffect, useState } from "react";
import { type ConnectOptions, connect, type PluginFrame } from "./web.js";

let shared: Promise<PluginFrame> | undefined;

/** The one connection of this document, made with `connect()` on first call. */
export function sharedConnection(options?: ConnectOptions): Promise<PluginFrame> {
  shared ??= connect(options);
  return shared;
}

export interface UsePlugin {
  /** The connection once the console answered; `null` before, and when it failed. */
  readonly frame: PluginFrame | null;
  readonly error: Error | null;
}

/** Connects to the console's page once, and answers the connection when it is there. */
export function usePlugin(options?: ConnectOptions): UsePlugin {
  const [state, setState] = useState<UsePlugin>({ frame: null, error: null });
  useEffect(() => {
    let live = true;
    sharedConnection(options).then(
      (frame) => {
        if (live) {
          setState({ frame, error: null });
        }
      },
      (error: unknown) => {
        if (live) {
          setState({
            frame: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [options]);
  return state;
}
