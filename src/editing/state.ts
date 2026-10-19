import type { EditingDefinition } from "../serialization/types.ts";
import type { EditingSnapshot, Revision } from "./types.ts";

/** Captured protocol methods retain their original receiver. */
export interface BoundEditing {
  readonly receiver: EditingDefinition;
  readonly capture: EditingDefinition["capture"];
}

/** Private mutable bookkeeping; observable state is always frozen. */
export interface EditingState {
  definition: BoundEditing | undefined;
  readOnly: boolean;
  counter: bigint;
  persistedRevision: Revision;
  busy: boolean;
  exclusive: "applying" | "capturing" | undefined;
  notificationDepth: number;
  getSnapshot(): EditingSnapshot;
  notify(): void;
}

/** Cache editing state and fence reentrant observer notifications. */
export function createEditingState(
  readOnly: boolean,
  publish: () => void,
): EditingState {
  let snapshot: EditingSnapshot = Object.freeze({ supported: false });
  const state: EditingState = {
    definition: undefined,
    readOnly,
    counter: 0n,
    persistedRevision: "0",
    busy: false,
    exclusive: undefined,
    notificationDepth: 0,
    getSnapshot() {
      if (
        state.definition &&
        (!snapshot.supported ||
          snapshot.readOnly !== state.readOnly ||
          snapshot.revision !== state.counter.toString() ||
          snapshot.persistedRevision !== state.persistedRevision ||
          snapshot.busy !== state.busy)
      ) {
        const revision = state.counter.toString();
        snapshot = Object.freeze({
          supported: true,
          readOnly: state.readOnly,
          busy: state.busy,
          revision,
          persistedRevision: state.persistedRevision,
          dirty: revision !== state.persistedRevision,
        });
      }
      return snapshot;
    },
    notify() {
      state.notificationDepth++;
      try {
        publish();
      } finally {
        state.notificationDepth--;
      }
    },
  };
  return state;
}
