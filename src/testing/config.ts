import type {
  PluginEditingChecks,
  PluginTestFixture,
  PluginTestSuiteOptions,
  UnsupportedSourceCase,
} from "./types.ts";

/** A fixed callback table; user-owned receiver state is deliberately not frozen. */
export interface Configuration<T extends PluginTestFixture> {
  readonly id: string;
  readonly createFixture: PluginTestSuiteOptions<T>["createFixture"];
  readonly verifyDocument: PluginTestSuiteOptions<T>["verifyDocument"];
  readonly fingerprint: PluginTestSuiteOptions<T>["fingerprint"];
  readonly editing: false | PluginEditingChecks<T>;
  readonly unsupported: readonly UnsupportedSourceCase<T>[];
  readonly pauseLoad: PluginTestSuiteOptions<T>["pauseLoad"];
  readonly verifyDisposed: PluginTestSuiteOptions<T>["verifyDisposed"];
  readonly onLateError: PluginTestSuiteOptions<T>["onLateError"];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected configuration object");
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(value))
    throw new TypeError("Invalid conformance ID");
  return value;
}

function callback<F extends (...args: never[]) => unknown>(
  receiver: Record<string, unknown>,
  key: string,
): F {
  const method = receiver[key];
  if (typeof method !== "function")
    throw new TypeError(`Expected callable ${key}`);
  return method.bind(receiver) as F;
}

function optional<F extends (...args: never[]) => unknown>(
  receiver: Record<string, unknown>,
  key: string,
): F | undefined {
  const method = receiver[key];
  if (method === undefined) return undefined;
  if (typeof method !== "function")
    throw new TypeError(`Expected callable ${key}`);
  return method.bind(receiver) as F;
}

/** Validate and snapshot every configuration field exactly once. */
export function configure<T extends PluginTestFixture>(
  options: PluginTestSuiteOptions<T>,
): Configuration<T> {
  try {
    const input = object(options);
    const editing = input.editing;
    let profile: false | PluginEditingChecks<T> = false;
    if (editing !== false) {
      const entry = object(editing);
      const noChange = optional<
        NonNullable<PluginEditingChecks<T>["noChange"]>
      >(entry, "noChange");
      const pending = optional<NonNullable<PluginEditingChecks<T>["pending"]>>(
        entry,
        "pending",
      );
      profile = Object.freeze({
        change: callback<PluginEditingChecks<T>["change"]>(entry, "change"),
        verifyChanged: callback<PluginEditingChecks<T>["verifyChanged"]>(
          entry,
          "verifyChanged",
        ),
        verifyOutput: callback<PluginEditingChecks<T>["verifyOutput"]>(
          entry,
          "verifyOutput",
        ),
        ...(noChange ? { noChange } : {}),
        ...(pending ? { pending } : {}),
      });
    }
    const rawUnsupported = input.unsupported;
    if (rawUnsupported !== undefined && !Array.isArray(rawUnsupported))
      throw new TypeError("Expected unsupported source cases");
    const seen = new Set<string>();
    const unsupported: UnsupportedSourceCase<T>[] = [];
    for (const raw of rawUnsupported ?? []) {
      const entry = object(raw);
      const entryId = id(entry.id);
      if (seen.has(entryId))
        throw new TypeError("Duplicate unsupported source ID");
      seen.add(entryId);
      unsupported.push(
        Object.freeze({
          id: entryId,
          createSource: callback<UnsupportedSourceCase<T>["createSource"]>(
            entry,
            "createSource",
          ),
        }),
      );
    }
    return Object.freeze({
      id: id(input.id),
      createFixture: callback<PluginTestSuiteOptions<T>["createFixture"]>(
        input,
        "createFixture",
      ),
      verifyDocument: callback<PluginTestSuiteOptions<T>["verifyDocument"]>(
        input,
        "verifyDocument",
      ),
      fingerprint: callback<PluginTestSuiteOptions<T>["fingerprint"]>(
        input,
        "fingerprint",
      ),
      editing: profile,
      unsupported: Object.freeze(unsupported),
      pauseLoad: optional<NonNullable<PluginTestSuiteOptions<T>["pauseLoad"]>>(
        input,
        "pauseLoad",
      ),
      verifyDisposed: optional<
        NonNullable<PluginTestSuiteOptions<T>["verifyDisposed"]>
      >(input, "verifyDisposed"),
      onLateError: optional<
        NonNullable<PluginTestSuiteOptions<T>["onLateError"]>
      >(input, "onLateError"),
    });
  } catch (cause) {
    throw new TypeError("Invalid plugin test suite configuration", { cause });
  }
}
