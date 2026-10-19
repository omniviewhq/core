import { OmniviewError } from "../errors.ts";
import type { CapabilityEntry, CapabilityKey } from "./types.ts";

/** Creates an immutable typed capability key with a validated namespace. */
export function defineCapability<T extends object>(
  id: `${string}:${string}`,
): CapabilityKey<T> {
  if (
    typeof id !== "string" ||
    !/^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/.test(id)
  ) {
    throw new OmniviewError("INVALID_CAPABILITY", "Invalid capability id");
  }
  return Object.freeze({ id });
}

/** Publishes a typed value in an immutable capability entry. */
export function provideCapability<T extends object>(
  key: CapabilityKey<T>,
  value: NoInfer<T>,
): CapabilityEntry {
  return Object.freeze({ key, value });
}
