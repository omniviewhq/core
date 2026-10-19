import type {
  DocumentSession,
  EditSession,
  ViewSession,
} from "../src/index.ts";

// Checked by bun check; this function deliberately never executes.
export function assertSessionTypes(session: DocumentSession): void {
  // @ts-expect-error Saving is unavailable until the session is narrowed.
  const unsafeSave: () => Promise<Blob> = session.save;
  void unsafeSave;
  if (session.mode === "edit") {
    const editor: EditSession = session;
    void editor.save;
  } else {
    const viewer: ViewSession = session;
    // @ts-expect-error A viewer-only plugin does not provide editing.
    void viewer.save;
  }
}
