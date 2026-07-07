#!/usr/bin/env node
import { runCli } from "./index.js";

runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
