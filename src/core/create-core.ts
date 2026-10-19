import { OmniviewError } from "../errors.ts";
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
  let disposal: Promise<void> | undefined;
  let sessions: readonly DocumentSession[] = Object.freeze([]);
  const core: Omniview = {
    createSession(source, sessionOptions) {
      if (disposal) throw new OmniviewError("CORE_CLOSED", "Core is disposed");
      if (
        !source ||
        typeof source.name !== "string" ||
        source.name.trim() === "" ||
        typeof source.mimeType !== "string" ||
        !Number.isSafeInteger(source.size) ||
        source.size < 0 ||
        typeof source.read !== "function"
      ) {
        throw new OmniviewError(
          "INVALID_SOURCE",
          "Expected a readable source with valid metadata",
        );
      }
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
        sessionOptions,
      );
      sessions = Object.freeze([...sessions, session]);
      return session;
    },
    async open(source, loadOptions) {
      const session = core.createSession(source, loadOptions);
      try {
        await session.load(loadOptions);
        return session;
      } catch (error) {
        try {
          await session.dispose();
        } catch (cleanupError) {
          report(cleanupError as OmniviewError);
        }
        throw error;
      }
    },
    getSessions: () => sessions,
    dispose() {
      if (disposal) return disposal;
      disposal = Promise.resolve().then(async () => {
        const results = await Promise.allSettled(
          sessions.map((session) => session.dispose()),
        );
        const errors = results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason);
        if (errors.length)
          throw new OmniviewError("CLEANUP_FAILED", "Core cleanup failed", {
            cause: new AggregateError(errors),
          });
      });
      return disposal;
    },
  };
  return core;
}
