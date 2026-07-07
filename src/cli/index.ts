import { runMigrate } from "./migrate.js";
import { runProjects } from "./projects.js";
import { runPrune } from "./prune.js";
import { runRollup } from "./rollup.js";
import { runServe } from "./serve.js";
import { runSourcemap } from "./sourcemap.js";

const USAGE = `Usage: schedulespark-observability <serve|migrate|prune|projects|sourcemap|rollup> [--db <connectionString>] [--schema <schema>]`;

/**
 * Dispatches a CLI invocation to the matching subcommand.
 */
export async function runCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === "serve") {
    await runServe(rest);
    return;
  }
  if (command === "migrate") {
    await runMigrate(rest);
    return;
  }
  if (command === "prune") {
    await runPrune(rest);
    return;
  }
  if (command === "projects") {
    await runProjects(rest);
    return;
  }
  if (command === "sourcemap") {
    await runSourcemap(rest);
    return;
  }
  if (command === "rollup") {
    await runRollup(rest);
    return;
  }
  console.error(USAGE);
  process.exitCode = 1;
}

export { runMigrate } from "./migrate.js";
export { runProjects } from "./projects.js";
export { runPrune } from "./prune.js";
export { runRollup } from "./rollup.js";
export { runServe } from "./serve.js";
export { runSourcemap } from "./sourcemap.js";
