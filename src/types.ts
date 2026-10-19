/** A named file supplied by the host application. */
export interface DocumentSource {
  readonly name: string;
  readonly data: Blob;
}

/** A document opened by a plugin that only provides viewing. */
export interface ViewSession {
  readonly mode: "view";
  dispose(): void;
}

/** A document opened by a plugin that also provides editing. */
export interface EditSession {
  readonly mode: "edit";
  /** Serialize the current document. Persistence belongs to the host. */
  save(): Promise<Blob>;
  dispose(): void;
}

/** Narrow by mode before calling editor-only methods. */
export type DocumentSession = ViewSession | EditSession;

/** The public contract consumed by plugins in their own repositories. */
export interface OmniviewPlugin {
  readonly id: string;
  supports(source: DocumentSource): boolean;
  open(source: DocumentSource): Promise<DocumentSession>;
}

/** Plugins are tried in the order supplied by the host. */
export interface OmniviewOptions {
  readonly plugins: readonly OmniviewPlugin[];
}

/** Framework-independent document orchestration. */
export interface Omniview {
  open(source: DocumentSource): Promise<DocumentSession>;
}
