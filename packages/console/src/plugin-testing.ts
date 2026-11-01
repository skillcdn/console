// A context for a plugin's own tests: records in memory, the console refusing what the test did
// not provide, everything emitted and logged kept for assertions.

export {
  createTestContext,
  type LoggedLine,
  type TestConsoleOptions,
  type TestContext,
  type TestContextOptions,
} from "./plugin/testing.js";
