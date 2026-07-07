import { parseArgs } from "node:util";

import Fastify from "fastify";

import { slackWebhookChannel, webhookChannel } from "../alerts/index.js";
import { createDashboard, registerDashboard } from "../dashboard/index.js";
import { initStorage } from "../storage/index.js";

import { parseCommonOptions, valueAsString } from "./options.js";

import type { NotificationChannel } from "../alerts/index.js";
import type { FastifyRequest } from "fastify";

const DEFAULT_PORT = 4318;

/**
 * `serve` subcommand: runs the dashboard as its own standalone HTTP server, for teams
 * who'd rather view it on a separate page than mount it inside a host application.
 */
export async function runServe(argv: string[]): Promise<void> {
  const common = parseCommonOptions(argv);
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      token: { type: "string" },
      "ingest-key": { type: "string" },
      webhook: { type: "string" },
      "slack-webhook": { type: "string" }
    },
    allowPositionals: true,
    strict: false
  });
  const port = parsePort(valueAsString(values.port));
  const token = valueAsString(values.token) ?? process.env.OBSERVABILITY_TOKEN;
  const ingestKey = valueAsString(values["ingest-key"]) ?? process.env.OBSERVABILITY_INGEST_KEY;
  const channels = buildChannels(values);

  const handle = await initStorage(common);
  const app = Fastify({ logger: true });
  registerDashboard(app, createDashboard(handle, { channels }), {
    authorize: (request) => authorizeStandalone(request, token),
    ingestKey
  });

  await app.listen({ port, host: "0.0.0.0" });
  console.error(`[observability] dashboard listening on http://localhost:${String(port)}`);
}

/**
 * Builds the alert channel list from `--webhook`/`--slack-webhook` flags or their
 * `OBSERVABILITY_*` environment variable equivalents.
 */
function buildChannels(values: Record<string, unknown>): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  const webhookUrl = valueAsString(values.webhook) ?? process.env.OBSERVABILITY_WEBHOOK_URL;
  const slackUrl = valueAsString(values["slack-webhook"]) ?? process.env.OBSERVABILITY_SLACK_WEBHOOK_URL;

  if (webhookUrl) {
    channels.push(webhookChannel(webhookUrl));
  }
  if (slackUrl) {
    channels.push(slackWebhookChannel(slackUrl));
  }
  return channels;
}

/**
 * Parses and validates the `--port` flag, falling back to the default port.
 */
function parsePort(raw: string | undefined): number {
  const port = Number(raw ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid --port value: "${raw ?? ""}"`);
  }
  return port;
}

/**
 * Simple bearer-token check for standalone mode. When no token is configured, every
 * request is allowed — hosts embedding the dashboard via `registerDashboard` directly
 * are expected to supply their own `authorize` hook instead.
 */
function authorizeStandalone(request: FastifyRequest, token: string | undefined): boolean {
  return !token || request.headers.authorization === `Bearer ${token}`;
}
