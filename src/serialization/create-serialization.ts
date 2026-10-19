import type { EditingController } from "../editing/create-editing.ts";
import type { Revision } from "../editing/types.ts";
import { type ErrorContext, OmniviewError } from "../errors.ts";
import { abortable, cancellation } from "../lifecycle/cancellation.ts";
import type { ErrorReporter } from "../lifecycle/reporting.ts";
import type { Cleanup } from "../plugins/types.ts";
import { createSource } from "../sources/blob-source.ts";
import type { ReadableSource, SourceMetadata } from "../sources/types.ts";
import type { OwnedCapture } from "./capture.ts";
import { createCapture } from "./capture.ts";
import type { SerializationResult, SerializeOptions } from "./types.ts";

/** Session-owned facilities shared with serialization. */
export interface SerializationHost {
  readonly editing: Pick<
    EditingController,
    "assertAvailable" | "capture" | "acknowledge"
  >;
  readonly source: SourceMetadata;
  context(): ErrorContext;
  isClosed(): boolean;
  own(cleanup: Cleanup): () => void;
  readonly report: ErrorReporter;
}

/** Private controller for independent captures and exact persistence receipts. */
export interface SerializationController {
  serialize(options?: SerializeOptions): Promise<SerializationResult>;
  markPersisted(result: SerializationResult): void;
  close(reason: OmniviewError): void;
}

interface Ticket {
  readonly controller: AbortController;
  registered: boolean;
  sessionClaimed: boolean;
}

/** Keep asynchronous encoders independent of the document's live writer. */
export function createSerialization(
  host: SerializationHost,
): SerializationController {
  const tickets = new Set<Ticket>();
  const receipts = new WeakMap<SerializationResult, Revision>();
  const failure = (cause: unknown): OmniviewError =>
    new OmniviewError("SERIALIZATION_FAILED", "Serialization failed", {
      context: host.context(),
      cause,
    });
  const normalize = (value: unknown): ReadableSource => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new TypeError("Expected serialized data");
    const data = "data" in value ? value.data : undefined;
    const name = "name" in value ? value.name : undefined;
    const mimeType = "mimeType" in value ? value.mimeType : undefined;
    if (!(data instanceof Blob) && !(data instanceof Uint8Array))
      throw new TypeError("Expected Blob or Uint8Array output");
    if (name !== undefined && typeof name !== "string")
      throw new TypeError("Invalid output name");
    if (mimeType !== undefined && typeof mimeType !== "string")
      throw new TypeError("Invalid output MIME type");
    return createSource(data, {
      name: name ?? host.source.name,
      mimeType: mimeType ?? host.source.mimeType,
    });
  };
  return {
    serialize(options: SerializeOptions = {}) {
      let external: AbortSignal | undefined;
      try {
        host.editing.assertAvailable();
        try {
          external = options.signal;
        } catch (cause) {
          throw failure(cause);
        }
        host.editing.assertAvailable();
        if (external?.aborted) throw cancellation(external, host.context());
      } catch (cause) {
        return Promise.reject(cause);
      }
      const controller = new AbortController();
      const ticket: Ticket = {
        controller,
        registered: false,
        sessionClaimed: false,
      };
      const capture = createCapture(host.context(), host.report);
      tickets.add(ticket);
      const abort = (): void => controller.abort(external?.reason);
      external?.addEventListener("abort", abort, { once: true });
      let revision: Revision = "0";
      let primary: OmniviewError | undefined;
      let unregister: (() => void) | undefined;
      let encode!: ReturnType<OwnedCapture["accept"]>;
      try {
        host.editing.capture((take, capturedRevision) => {
          revision = capturedRevision;
          try {
            encode = capture.accept(take());
          } finally {
            if (!host.isClosed()) {
              unregister = host.own(capture.dispose);
              ticket.registered = true;
            }
          }
        });
      } catch (cause) {
        primary = failure(cause);
      }
      return (async (): Promise<SerializationResult> => {
        let source!: ReadableSource;
        try {
          if (controller.signal.aborted)
            primary = cancellation(controller.signal, host.context());
          if (!primary)
            source = normalize(
              await abortable(
                () =>
                  encode(
                    Object.freeze({ signal: controller.signal, revision }),
                  ),
                controller.signal,
                host.context(),
              ),
            );
        } catch (cause) {
          primary = controller.signal.aborted
            ? cancellation(controller.signal, host.context())
            : failure(cause);
        }
        let cleanupError: unknown;
        try {
          await capture.dispose();
        } catch (cause) {
          cleanupError = cause;
        }
        unregister?.();
        tickets.delete(ticket);
        external?.removeEventListener("abort", abort);
        if (!primary && controller.signal.aborted)
          primary = cancellation(controller.signal, host.context());
        if (primary) {
          if (cleanupError && !ticket.sessionClaimed)
            host.report(cleanupError as OmniviewError);
          throw primary;
        }
        if (cleanupError) throw cleanupError;
        const result = Object.freeze({ revision, source });
        receipts.set(result, revision);
        return result;
      })();
    },
    markPersisted(result) {
      host.editing.assertAvailable();
      const revision = receipts.get(result);
      if (revision === undefined)
        throw new OmniviewError(
          "INVALID_PERSISTENCE",
          "Expected an exact result issued by this session",
          { context: host.context() },
        );
      host.editing.acknowledge(revision);
    },
    close(reason) {
      for (const ticket of tickets) ticket.sessionClaimed = ticket.registered;
      for (const ticket of tickets) ticket.controller.abort(reason);
    },
  };
}
