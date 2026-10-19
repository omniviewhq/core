/** Identifying metadata for a readable file. */
export interface SourceMetadata {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
}

/** Byte offsets use an inclusive start and an exclusive end. */
export interface ReadOptions {
  readonly start?: number;
  readonly end?: number;
  readonly signal?: AbortSignal;
}

/** A host-owned source that returns independently owned byte arrays. */
export interface ReadableSource extends SourceMetadata {
  read(options?: ReadOptions): Promise<Uint8Array>;
}

/** Optional metadata overrides when adapting bytes or a Blob. */
export interface SourceOptions {
  readonly name?: string;
  readonly mimeType?: string;
}
