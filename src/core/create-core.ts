import { createReporter } from "../lifecycle/reporting.ts";
import { createRegistry } from "../plugins/registry.ts";
import { createSession } from "../sessions/create-session.ts";
import type { DocumentSession } from "../sessions/types.ts";
import type { CoreOptions, Omniview } from "./types.ts";

/** Create a headless plugin registry with managed document sessions. */
export function createOmniview(options: CoreOptions): Omniview {
  const report = createReporter(options.onError);
  const plugins = createRegistry(options.plugins);
  let nextId = 0;
  let sessions: readonly DocumentSession[] = Object.freeze([]);
  const core: Omniview = {
    createSession(source) {
      const session = createSession(
        `session-${++nextId}`,
        source,
        plugins,
        () => {
          sessions = Object.freeze(
            sessions.filter((current) => current !== session),
          );
        },
        report,
      );
      sessions = Object.freeze([...sessions, session]);
      return session;
    },
    async open(source, loadOptions) {
      const session = core.createSession(source, loadOptions);
      await session.load(loadOptions);
      return session;
    },
    getSessions: () => sessions,
    async dispose() {
      await Promise.all(sessions.map((session) => session.dispose()));
    },
  };
  return core;
}
