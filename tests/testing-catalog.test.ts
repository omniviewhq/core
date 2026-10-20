import { test } from "bun:test";
import { createPluginTestSuite } from "../src/testing/index.ts";
import {
  editableSuiteOptions,
  viewerSuiteOptions,
} from "./support/conformance-fixture.ts";

for (const suite of [
  createPluginTestSuite(viewerSuiteOptions()),
  createPluginTestSuite(editableSuiteOptions()),
]) {
  for (const check of suite.cases) test(check.id, () => check.run());
}
