import { OmniviewError } from "../errors.ts";
import { abortable } from "../lifecycle/cancellation.ts";
import type { ReadableSource, ReadOptions, SourceOptions } from "./types.ts";

/** Adapt a Blob, File, or byte array to a named readable source. */
export function createSource(
  input: Blob | Uint8Array,
  options: SourceOptions = {},
): ReadableSource {
  if (!(input instanceof Blob) && !(input instanceof Uint8Array)) {
    throw new OmniviewError("INVALID_SOURCE", "Expected a Blob or Uint8Array");
  }
  const blob =
    input instanceof Uint8Array
      ? new Blob([new Uint8Array(input).buffer])
      : input;
  const name =
    options.name ??
    ("name" in input && typeof input.name === "string"
      ? input.name
      : "document");
  if (typeof name !== "string" || name.trim() === "") {
    throw new OmniviewError("INVALID_SOURCE", "Source name must not be empty");
  }
  const mimeType =
    options.mimeType ??
    (input instanceof Uint8Array ? "application/octet-stream" : blob.type);
  if (typeof mimeType !== "string")
    throw new OmniviewError("INVALID_SOURCE", "Invalid MIME type");
  return Object.freeze({
    name,
    size: blob.size,
    mimeType,
    async read(range: ReadOptions = {}): Promise<Uint8Array> {
      const start = range.start ?? 0;
      const end = range.end ?? blob.size;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        end > blob.size
      ) {
        throw new OmniviewError("INVALID_RANGE", "Invalid source byte range", {
          context: { sourceName: name },
        });
      }
      return new Uint8Array(
        await abortable(
          () => blob.slice(start, end).arrayBuffer(),
          range.signal,
          { sourceName: name },
        ),
      );
    },
  });
}
