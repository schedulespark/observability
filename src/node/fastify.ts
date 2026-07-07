import type { ObservabilityClient } from "./client.js";
import type { EventContext } from "../core/index.js";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Registers a Fastify `onError` hook that reports every request-lifecycle error to
 * the observability client with method/route/status context attached.
 */
export function captureFastifyErrors(app: FastifyInstance, client: ObservabilityClient): void {
  app.addHook("onError", (request, reply, error, done) => {
    client.captureException(error, requestContext(request, reply.statusCode));
    done();
  });
}

/**
 * Builds event context from a Fastify request/response pair.
 */
function requestContext(request: FastifyRequest, statusCode: number): EventContext {
  return {
    method: request.method,
    route: request.url,
    statusCode
  };
}
