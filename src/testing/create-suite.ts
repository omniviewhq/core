import { baselineCases } from "./cases/baseline.ts";
import { editingCases } from "./cases/editing.ts";
import { pendingCases } from "./cases/pending.ts";
import { persistenceCases } from "./cases/persistence.ts";
import { serializationCases } from "./cases/serialization.ts";
import { configure } from "./config.ts";
import type { Scenario } from "./context.ts";
import { runCase } from "./run.ts";
import type {
  PluginConformanceOmission,
  PluginTestFixture,
  PluginTestSuite,
  PluginTestSuiteOptions,
} from "./types.ts";

/** Discover explicit portable cases without invoking any author callback. */
export function createPluginTestSuite<T extends PluginTestFixture>(
  options: PluginTestSuiteOptions<T>,
): PluginTestSuite {
  const config = configure(options);
  const scenarios: Scenario<T>[] = baselineCases(config);
  scenarios.push(...pendingCases(config));
  if (config.editing !== false)
    scenarios.push(
      ...editingCases(config.editing),
      ...serializationCases(config.editing),
      ...persistenceCases(config.editing),
    );
  const omitted: PluginConformanceOmission[] = [];
  if (config.editing === false)
    omitted.push({ id: `${config.id}/editing`, reason: "Viewer-only fixture" });
  else {
    if (!config.editing.noChange)
      omitted.push({
        id: `${config.id}/editing/noop`,
        reason: "No no-op adapter supplied",
      });
    if (!config.editing.pending)
      omitted.push({
        id: `${config.id}/editing/pending`,
        reason: "No controlled edit supplied",
      });
  }
  if (!config.pauseLoad)
    omitted.push({
      id: `${config.id}/load/pending`,
      reason: "No controlled load supplied",
    });
  if (!config.unsupported.length)
    omitted.push({
      id: `${config.id}/unsupported`,
      reason: "No unsupported source fixtures supplied",
    });
  if (!config.verifyDisposed)
    omitted.push({
      id: `${config.id}/cleanup/plugin`,
      reason: "No plugin resource verification supplied",
    });
  return Object.freeze({
    id: config.id,
    cases: Object.freeze(
      scenarios.map((scenario) =>
        Object.freeze({
          id: `${config.id}/${scenario.suffix}`,
          name: `${config.id}: ${scenario.name}`,
          run: () =>
            runCase(`${config.id}/${scenario.suffix}`, config, scenario),
        }),
      ),
    ),
    omitted: Object.freeze(omitted.map((entry) => Object.freeze(entry))),
  });
}
