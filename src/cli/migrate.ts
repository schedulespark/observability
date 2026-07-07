import { closeStorage, initStorage } from "../storage/index.js";

import { parseCommonOptions } from "./options.js";

const MIGRATE_LOG_PREFIX = "[observability]";

/**
 * `migrate` subcommand: applies any pending schema migrations and exits. Intended for
 * production deploys, where migrating explicitly ahead of time is safer than the
 * automatic on-`init()` migration the Node SDK does in development.
 */
export async function runMigrate(argv: string[]): Promise<void> {
  const options = parseCommonOptions(argv);
  const handle = await initStorage(options);
  console.error(`${MIGRATE_LOG_PREFIX} schema "${handle.schema}" is up to date`);
  await closeStorage(handle);
}
