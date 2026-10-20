import { createOmniview, type Omniview, OmniviewError } from "../index.ts";
import type { Cleanup, PluginDefinition } from "../plugins/types.ts";
import { BoundaryFailure } from "./assertions.ts";
import type { Configuration } from "./config.ts";
import type { RunContext, Scenario } from "./context.ts";
import { createControlScope } from "./control.ts";
import { PluginConformanceError } from "./errors.ts";
import type { PluginConformancePhase, PluginTestFixture } from "./types.ts";

/** Run one case with private ownership and no runner-specific scheduling. */
export async function runCase<T extends PluginTestFixture>(
  caseId: string,
  options: Configuration<T>,
  scenario: Scenario<T>,
): Promise<void> {
  const cores: Omniview[] = [];
  const disposed = new Set<object>();
  const diagnostics: OmniviewError[] = [];
  const cleanupErrors: unknown[] = [];
  let phase: PluginConformancePhase = "fixture";
  let primary: { cause: unknown; phase: PluginConformancePhase } | undefined;
  let fixture: T | undefined;
  let cleanup: Cleanup | undefined;
  let settled = false;
  const deliverLate = (error: PluginConformanceError): void => {
    try {
      if (options.onLateError) options.onLateError(error);
      else console.error(error);
    } catch (cause) {
      try {
        console.error(error, cause);
      } catch {}
    }
  };
  const controls = createControlScope((cause) => {
    if (!settled) {
      cleanupErrors.push(cause);
      return;
    }
    deliverLate(
      new PluginConformanceError(`Late control in ${caseId}`, {
        caseId,
        phase: "cleanup",
        cause,
        cleanupErrors: [cause],
      }),
    );
  });
  const report = (error: OmniviewError): void => {
    if (!settled) {
      diagnostics.push(error);
      return;
    }
    const late = new PluginConformanceError(`Late diagnostic in ${caseId}`, {
      caseId,
      phase: "cleanup",
      cause: error,
      diagnostics: [error],
    });
    deliverLate(late);
  };
  try {
    fixture = await options.createFixture();
    if (!fixture || typeof fixture !== "object" || Array.isArray(fixture))
      throw new TypeError("Expected plugin test fixture");
    const dispose = fixture.dispose;
    if (dispose !== undefined && typeof dispose !== "function")
      throw new TypeError("Fixture dispose must be callable");
    if (dispose) {
      const receiver = fixture;
      cleanup = () => dispose.call(receiver);
    }
    const plugin: PluginDefinition = fixture.plugin;
    const createSource = fixture.createSource;
    if (typeof createSource !== "function")
      throw new TypeError("Fixture createSource must be callable");
    const receiver = fixture;
    const context: RunContext<T> = {
      fixture,
      options,
      core(readOnly) {
        try {
          const core = createOmniview({
            plugins: [plugin],
            onError: report,
            ...(readOnly === undefined ? {} : { readOnly }),
          });
          cores.push(core);
          return core;
        } catch (cause) {
          throw new BoundaryFailure("fixture", cause);
        }
      },
      async source(factory) {
        try {
          const source = await (factory
            ? factory()
            : createSource.call(receiver));
          if (
            !source ||
            typeof source !== "object" ||
            Array.isArray(source) ||
            typeof source.name !== "string" ||
            !source.name.trim() ||
            typeof source.mimeType !== "string" ||
            !Number.isSafeInteger(source.size) ||
            source.size < 0 ||
            typeof source.read !== "function"
          )
            throw new TypeError("Expected readable fixture source");
          return source;
        } catch (cause) {
          throw new BoundaryFailure("fixture", cause);
        }
      },
      async open(core, sessionOptions, source) {
        try {
          return await core.open(
            source ?? (await context.source()),
            sessionOptions,
          );
        } catch (cause) {
          if (cause instanceof BoundaryFailure) throw cause;
          // Plugin work crosses the core's PLUGIN_FAILED boundary. Raw throws
          // here come from fixture metadata access during source admission.
          if (
            !(cause instanceof OmniviewError) ||
            cause.code === "INVALID_SOURCE"
          )
            throw new BoundaryFailure("fixture", cause);
          throw cause;
        }
      },
      createSession(core, source, sessionOptions) {
        try {
          return core.createSession(source, sessionOptions);
        } catch (cause) {
          if (
            !(cause instanceof OmniviewError) ||
            cause.code === "INVALID_SOURCE"
          )
            throw new BoundaryFailure("fixture", cause);
          throw cause;
        }
      },
      async dispose(target) {
        try {
          await target.dispose();
        } catch (cause) {
          throw new BoundaryFailure("cleanup", cause);
        } finally {
          disposed.add(target);
        }
      },
      async verification(start) {
        const value = await start();
        if (value !== undefined)
          throw new BoundaryFailure(
            "fixture",
            new TypeError("Verification must return undefined"),
          );
      },
      async verify(session) {
        await context.verification(() =>
          options.verifyDocument(Object.freeze({ fixture: receiver, session })),
        );
      },
      async fingerprint(session) {
        const value = await options.fingerprint(
          Object.freeze({ fixture: receiver, session }),
        );
        if (typeof value !== "string")
          throw new BoundaryFailure(
            "fixture",
            new TypeError("Fingerprint must be a string"),
          );
        return value;
      },
      async loadControl(start) {
        try {
          const value = start();
          // Own a synchronous box before inspecting its thenability. Awaiting
          // it first could lose acquired cleanup through a throwing then getter.
          if (
            value &&
            typeof value === "object" &&
            ("release" in value || "entered" in value || "drained" in value)
          )
            return controls.load(value as import("./types.ts").ControlledLoad);
          return controls.load(await value);
        } catch (cause) {
          throw cause instanceof BoundaryFailure
            ? cause
            : new BoundaryFailure("fixture", cause);
        }
      },
      editControl(start) {
        try {
          return controls.edit(start());
        } catch (cause) {
          throw cause instanceof BoundaryFailure
            ? cause
            : new BoundaryFailure("fixture", cause);
        }
      },
    };
    phase = "check";
    await scenario.run(context);
  } catch (cause) {
    if (cause instanceof BoundaryFailure && cause.phase === "cleanup")
      cleanupErrors.push(cause.cause);
    else
      primary =
        cause instanceof BoundaryFailure
          ? { cause: cause.cause, phase: cause.phase }
          : { cause, phase };
  }
  cleanupErrors.push(...(await controls.cleanup()));
  for (const core of cores) {
    if (disposed.has(core)) continue;
    try {
      await core.dispose();
    } catch (cause) {
      cleanupErrors.push(cause);
    }
  }
  if (fixture && options.verifyDisposed) {
    try {
      const value = await options.verifyDisposed(fixture);
      if (value !== undefined)
        throw new BoundaryFailure(
          "fixture",
          new TypeError("Verification must return undefined"),
        );
    } catch (cause) {
      if (cause instanceof BoundaryFailure && !primary)
        primary = { phase: cause.phase, cause: cause.cause };
      else
        cleanupErrors.push(
          cause instanceof BoundaryFailure ? cause.cause : cause,
        );
    }
  }
  if (cleanup) {
    try {
      await cleanup();
    } catch (cause) {
      cleanupErrors.push(cause);
    }
  }
  settled = true;
  if (!primary && diagnostics.length)
    primary = {
      phase: "check",
      cause: new AggregateError(diagnostics, "Unexpected plugin diagnostics"),
    };
  if (!primary && cleanupErrors.length)
    primary = {
      phase: "cleanup",
      cause: new AggregateError(cleanupErrors, "Conformance cleanup failed"),
    };
  if (primary)
    throw new PluginConformanceError(`Conformance failed: ${caseId}`, {
      caseId,
      phase: primary.phase,
      cause: primary.cause,
      diagnostics,
      cleanupErrors,
    });
}
