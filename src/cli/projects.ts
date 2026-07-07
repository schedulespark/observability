import { parseArgs } from "node:util";

import { closeStorage, createProject, initStorage, listProjects } from "../storage/index.js";

import { parseCommonOptions, valueAsString } from "./options.js";

const USAGE = "Usage: schedulespark-observability projects <create|list> [--db <connectionString>] [--schema <schema>]";

/**
 * `projects` subcommand: manages multi-project setups (`create --name X`, `list`).
 * A fresh single-project install never needs this — every schema already has an
 * auto-created `default` project.
 */
export async function runProjects(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  if (subcommand === "create") {
    await runProjectsCreate(rest);
    return;
  }
  if (subcommand === "list") {
    await runProjectsList(rest);
    return;
  }
  console.error(USAGE);
  process.exitCode = 1;
}

/**
 * `projects create --name X`: creates a project and prints its generated API key.
 */
async function runProjectsCreate(argv: string[]): Promise<void> {
  const common = parseCommonOptions(argv);
  const { values } = parseArgs({
    args: argv,
    options: { name: { type: "string" } },
    allowPositionals: true,
    strict: false
  });
  const name = valueAsString(values.name);
  if (!name) {
    throw new Error("A project name is required: pass --name.");
  }

  const handle = await initStorage(common);
  const project = await createProject(handle, name);
  console.error(JSON.stringify(project, null, 2));
  await closeStorage(handle);
}

/**
 * `projects list`: prints every configured project.
 */
async function runProjectsList(argv: string[]): Promise<void> {
  const common = parseCommonOptions(argv);
  const handle = await initStorage(common);
  const projects = await listProjects(handle);
  console.error(JSON.stringify(projects, null, 2));
  await closeStorage(handle);
}
