import { randomUUID } from "node:crypto";
import { RpcError, type ServerCallContext, type ServiceInfo } from "@protobuf-ts/runtime-rpc";
import { classifyError } from "../errors";
import { runWithContext } from "../observability/context";
import { logger } from "../observability/logger";

export const TRACE_HEADER = "x-trace-id";
const INCOMING_TRACE_HEADERS = [TRACE_HEADER, "x-request-id"] as const;
const TRACE_ID_PATTERN = /^[\w.-]{1,128}$/;

/** Honour a well-formed caller-supplied id so traces join up across services; otherwise mint one. */
export function resolveTraceId(ctx: ServerCallContext | undefined): string {
	for (const header of INCOMING_TRACE_HEADERS) {
		const raw = ctx?.headers?.[header];
		const value = Array.isArray(raw) ? raw[0] : raw;
		if (typeof value === "string" && TRACE_ID_PATTERN.test(value)) return value;
	}
	return randomUUID();
}

function isSoftFailure(response: unknown): response is { success: false; error?: unknown } {
	return (
		typeof response === "object" &&
		response !== null &&
		"success" in response &&
		response.success === false
	);
}

type UnaryMethod = (request: unknown, ctx?: ServerCallContext) => Promise<unknown>;

/**
 * Wraps every method of a service implementation so that each call:
 *  - gets a trace id (sent as the `x-trace-id` response header, in trailers on
 *    success and in the error metadata on failure),
 *  - runs inside an AsyncLocalStorage context so every log line emitted by the
 *    handler and the services it calls carries the same trace id,
 *  - maps thrown errors to a gRPC status code via `classifyError`, masking the
 *    message of unexpected errors,
 *  - emits exactly one structured "rpc" summary log line.
 *
 * `ctx` may be undefined (direct invocation in tests); the wrapper still works.
 */
export function withTracing<T extends object>(serviceInfo: ServiceInfo, impl: T): T {
	const wrapped: Record<string, UnaryMethod> = {};
	const source = impl as unknown as Record<string, UnaryMethod>;

	for (const methodInfo of serviceInfo.methods) {
		const name = methodInfo.localName;
		const original = source[name];
		if (typeof original !== "function") continue;
		const method = `${serviceInfo.typeName}/${methodInfo.name}`;

		wrapped[name] = (request, ctx) => {
			const traceId = resolveTraceId(ctx);
			try {
				ctx?.sendResponseHeaders({ [TRACE_HEADER]: traceId });
			} catch {
				// Headers already sent or call cancelled; the id still goes out in trailers/error meta.
			}
			const context = { traceId, method };
			return runWithContext(context, async () => {
				const started = performance.now();
				const durationMs = () => Math.round((performance.now() - started) * 10) / 10;
				try {
					const response = await original.call(impl, request, ctx);
					if (ctx) ctx.trailers = { ...ctx.trailers, [TRACE_HEADER]: traceId };
					if (isSoftFailure(response)) {
						logger.warn("rpc", {
							code: "OK",
							outcome: "soft_failure",
							durationMs: durationMs(),
							responseError: response.error,
						});
					} else {
						logger.info("rpc", { code: "OK", outcome: "success", durationMs: durationMs() });
					}
					return response;
				} catch (error) {
					const classified =
						error instanceof RpcError
							? {
									code: error.code,
									publicMessage: error.message,
									errorClass: error.name,
									errorMessage: error.message,
									expected: error.code !== "INTERNAL" && error.code !== "UNKNOWN",
								}
							: classifyError(error);
					const fields = {
						code: classified.code,
						outcome: "error",
						durationMs: durationMs(),
						errorClass: classified.errorClass,
						errorMessage: classified.errorMessage,
					};
					if (classified.expected) {
						logger.warn("rpc", fields);
					} else {
						logger.error("rpc", {
							...fields,
							stack: error instanceof Error ? error.stack : undefined,
						});
					}
					throw new RpcError(classified.publicMessage, classified.code, {
						[TRACE_HEADER]: traceId,
					});
				}
			});
		};
	}

	return { ...source, ...wrapped } as unknown as T;
}
