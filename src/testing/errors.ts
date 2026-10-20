import type { OmniviewError } from "../errors.ts";
import type {
  PluginConformanceErrorOptions,
  PluginConformancePhase,
} from "./types.ts";

/** A failed conformance boundary, preserving the original failure and cleanup. */
export class PluginConformanceError extends Error {
  readonly caseId: string;
  readonly phase: PluginConformancePhase;
  readonly diagnostics: readonly OmniviewError[];
  readonly cleanupErrors: readonly unknown[];

  constructor(message: string, options: PluginConformanceErrorOptions) {
    super(message, options);
    this.name = "PluginConformanceError";
    this.caseId = options.caseId;
    this.phase = options.phase;
    this.diagnostics = Object.freeze([...(options.diagnostics ?? [])]);
    this.cleanupErrors = Object.freeze([...(options.cleanupErrors ?? [])]);
  }
}
