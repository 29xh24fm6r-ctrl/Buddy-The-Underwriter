export function assertServerOnly() {
  const argv = typeof process !== "undefined" ? process.argv ?? [] : [];
  const isNodeTest = Array.isArray(argv) && argv.includes("--test");
  const isTestEnv = process.env.NODE_ENV === "test" || isNodeTest;
  if (isTestEnv) return;
  const isNextRuntime = Boolean(process.env.NEXT_RUNTIME || process.env.NEXT_PHASE);
  if (!isNextRuntime) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("server-only");
}
