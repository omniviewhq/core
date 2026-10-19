import { definePlugin, type PluginDefinition } from "../../src/sdk/index.ts";

export function fixturePlugin(
  overrides: Partial<PluginDefinition> = {},
): PluginDefinition {
  return definePlugin({
    id: "fixture/text",
    apiVersion: 1,
    supports: () => true,
    open: () => ({}),
    ...overrides,
  });
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
