import { type ErrorContext, OmniviewError } from "../errors.ts";
import { defineCapability } from "./define-capability.ts";
import type { CapabilityEntry } from "./types.ts";

/** Validate and snapshot the capabilities exposed by one plugin result. */
export function collectCapabilities(
  entries: readonly CapabilityEntry[] | undefined,
  context: ErrorContext,
): ReadonlyMap<string, object> {
  const values = new Map<string, object>();
  if (entries === undefined) return values;
  if (!Array.isArray(entries))
    throw new OmniviewError(
      "INVALID_CAPABILITY",
      "Capabilities must be an array",
      { context },
    );
  for (const entry of entries) {
    let id: string;
    let value: object;
    try {
      id = defineCapability(entry?.key?.id).id;
      value = entry.value;
    } catch (cause) {
      throw new OmniviewError(
        "INVALID_CAPABILITY",
        "Invalid capability entry",
        { context, cause },
      );
    }
    if (typeof value !== "object" || value === null) {
      throw new OmniviewError(
        "INVALID_CAPABILITY",
        "Capability must have a key and object value",
        { context },
      );
    }
    if (values.has(id))
      throw new OmniviewError(
        "CAPABILITY_CONFLICT",
        "Duplicate capability id",
        { context },
      );
    values.set(id, value);
  }
  return values;
}
