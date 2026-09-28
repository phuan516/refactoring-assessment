import { PostsService } from "@chirp/proto";
import {
	RpcError,
	type RpcMetadata,
	type ServerCallContext,
	ServerCallContextController,
} from "@protobuf-ts/runtime-rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AlreadyExistsError,
	FailedPreconditionError,
	InternalError,
	InvalidArgumentError,
	NotFoundError,
	PermissionDeniedError,
	UnauthenticatedError,
} from "../../errors";
import { getTraceId } from "../../observability/context";
import { logger, setLogLevel, setLogSink } from "../../observability/logger";
import { withTracing } from "../with-tracing";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const getPostMethod = PostsService.methods.find((m) => m.localName === "getPost");

interface FakeCall {
	ctx: ServerCallContext;
	sentHeaders: RpcMetadata[];
}

function fakeCall(headers: RpcMetadata = {}): FakeCall {
	if (!getPostMethod) throw new Error("getPost method missing from PostsService");
	const sentHeaders: RpcMetadata[] = [];
	const ctx = new ServerCallContextController(getPostMethod, headers, new Date(), (data) =>
		sentHeaders.push(data),
	);
	return { ctx, sentHeaders };
}

type Impl = {
	getPost: (request: unknown, ctx?: ServerCallContext) => Promise<unknown>;
	createPost: (request: unknown, ctx?: ServerCallContext) => Promise<unknown>;
};

function buildImpl(getPost: () => Promise<unknown>): Impl {
	return {
		getPost,
		createPost: async () => ({ success: false, postId: "", error: "Post content is required" }),
	};
}

function wrap(impl: Impl): Impl {
	return withTracing(PostsService, impl);
}

let lines: Record<string, unknown>[];
let restoreSink: () => void;

beforeEach(() => {
	lines = [];
	restoreSink = setLogSink((line) => lines.push(JSON.parse(line)));
	setLogLevel("debug");
});

afterEach(() => {
	restoreSink();
	setLogLevel("silent");
});

function rpcLines() {
	return lines.filter((line) => line.msg === "rpc");
}

async function captureRpcError(promise: Promise<unknown>): Promise<RpcError> {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(RpcError);
	if (!(error instanceof RpcError)) throw new Error("expected RpcError");
	return error;
}

describe("withTracing error mapping", () => {
	it.each([
		[new InvalidArgumentError("Post content is required"), "INVALID_ARGUMENT"],
		[new UnauthenticatedError("Invalid email or password"), "UNAUTHENTICATED"],
		[new PermissionDeniedError("You can only edit your own posts"), "PERMISSION_DENIED"],
		[new NotFoundError("Post not found"), "NOT_FOUND"],
		[new AlreadyExistsError("Username already taken"), "ALREADY_EXISTS"],
		[new FailedPreconditionError("Edit window has expired (5 minutes)"), "FAILED_PRECONDITION"],
	])("maps %s to %s with the original message", async (thrown, code) => {
		const { ctx } = fakeCall();
		const service = wrap(buildImpl(() => Promise.reject(thrown)));

		const error = await captureRpcError(service.getPost({}, ctx));

		expect(error.code).toBe(code);
		expect(error.message).toBe(thrown.message);
		expect(rpcLines()).toHaveLength(1);
		expect(rpcLines()[0]).toMatchObject({ level: "warn", code, errorClass: thrown.name });
	});

	it("maps an unexpected Error to INTERNAL and masks its message", async () => {
		const service = wrap(buildImpl(() => Promise.reject(new Error("SQLITE_BUSY: db is locked"))));

		const error = await captureRpcError(service.getPost({}, fakeCall().ctx));

		expect(error.code).toBe("INTERNAL");
		expect(error.message).toBe("Internal server error");
		expect(rpcLines()[0]).toMatchObject({
			level: "error",
			code: "INTERNAL",
			errorClass: "Error",
			errorMessage: "SQLITE_BUSY: db is locked",
		});
		expect(rpcLines()[0]?.stack).toEqual(expect.stringContaining("SQLITE_BUSY"));
	});

	it("maps InternalError to INTERNAL and masks its message", async () => {
		const service = wrap(buildImpl(() => Promise.reject(new InternalError("secret detail"))));

		const error = await captureRpcError(service.getPost({}, fakeCall().ctx));

		expect(error.code).toBe("INTERNAL");
		expect(error.message).toBe("Internal server error");
	});

	it("maps a non-Error rejection to INTERNAL", async () => {
		const service = wrap(buildImpl(() => Promise.reject("boom")));

		const error = await captureRpcError(service.getPost({}, fakeCall().ctx));

		expect(error.code).toBe("INTERNAL");
		expect(error.message).toBe("Internal server error");
		expect(rpcLines()[0]).toMatchObject({ errorClass: "string", errorMessage: "boom" });
	});

	it("maps legacy auth middleware messages without masking them", async () => {
		const unauthenticated = wrap(
			buildImpl(() => Promise.reject(new Error("Invalid or expired session token"))),
		);
		const forbidden = wrap(buildImpl(() => Promise.reject(new Error("Admin access required"))));

		const authError = await captureRpcError(unauthenticated.getPost({}, fakeCall().ctx));
		const adminError = await captureRpcError(forbidden.getPost({}, fakeCall().ctx));

		expect(authError.code).toBe("UNAUTHENTICATED");
		expect(authError.message).toBe("Invalid or expired session token");
		expect(adminError.code).toBe("PERMISSION_DENIED");
		expect(adminError.message).toBe("Admin access required");
	});

	it("passes an RpcError thrown by a handler through unchanged", async () => {
		const service = wrap(
			buildImpl(() => Promise.reject(new RpcError("slow down", "RESOURCE_EXHAUSTED"))),
		);

		const error = await captureRpcError(service.getPost({}, fakeCall().ctx));

		expect(error.code).toBe("RESOURCE_EXHAUSTED");
		expect(error.message).toBe("slow down");
	});
});

describe("withTracing trace ids", () => {
	it("generates a UUID and sends it in response headers and trailers on success", async () => {
		const { ctx, sentHeaders } = fakeCall();
		const service = wrap(buildImpl(async () => ({ id: "p1" })));

		const response = await service.getPost({}, ctx);

		expect(response).toEqual({ id: "p1" });
		const traceId = sentHeaders[0]?.["x-trace-id"];
		expect(traceId).toMatch(UUID_PATTERN);
		expect(ctx.trailers["x-trace-id"]).toBe(traceId);
		expect(rpcLines()).toEqual([
			expect.objectContaining({
				level: "info",
				method: "chirp.posts.PostsService/GetPost",
				traceId,
				code: "OK",
				outcome: "success",
				durationMs: expect.any(Number),
			}),
		]);
	});

	it("honours a well-formed incoming x-trace-id", async () => {
		const { ctx, sentHeaders } = fakeCall({ "x-trace-id": "client-supplied.id_123" });
		const service = wrap(buildImpl(async () => ({})));

		await service.getPost({}, ctx);

		expect(sentHeaders[0]).toEqual({ "x-trace-id": "client-supplied.id_123" });
		expect(rpcLines()[0]?.traceId).toBe("client-supplied.id_123");
	});

	it("falls back to x-request-id when x-trace-id is absent", async () => {
		const { ctx, sentHeaders } = fakeCall({ "x-request-id": "req-42" });
		const service = wrap(buildImpl(async () => ({})));

		await service.getPost({}, ctx);

		expect(sentHeaders[0]).toEqual({ "x-trace-id": "req-42" });
	});

	it.each([
		["contains illegal characters", "abc def\n{}"],
		["is oversized", "a".repeat(129)],
		["is empty", ""],
	])("replaces an incoming id that %s", async (_label, incoming) => {
		const { ctx, sentHeaders } = fakeCall({ "x-trace-id": incoming });
		const service = wrap(buildImpl(async () => ({})));

		await service.getPost({}, ctx);

		expect(sentHeaders[0]?.["x-trace-id"]).toMatch(UUID_PATTERN);
	});

	it("puts the trace id in the error metadata when the call fails", async () => {
		const { ctx } = fakeCall({ "x-trace-id": "trace-err" });
		const service = wrap(buildImpl(() => Promise.reject(new NotFoundError("Post not found"))));

		const error = await captureRpcError(service.getPost({}, ctx));

		expect(error.meta).toEqual({ "x-trace-id": "trace-err" });
		expect(rpcLines()[0]).toMatchObject({ traceId: "trace-err", code: "NOT_FOUND" });
	});

	it("propagates the trace id into logs emitted from nested async code", async () => {
		const { ctx } = fakeCall({ "x-trace-id": "nested-trace" });
		let seenInService: string | undefined;
		const deepService = async () => {
			await new Promise((resolve) => setTimeout(resolve, 1));
			seenInService = getTraceId();
			logger.info("service_step");
		};
		const service = wrap(
			buildImpl(async () => {
				await deepService();
				return {};
			}),
		);

		await service.getPost({}, ctx);

		expect(seenInService).toBe("nested-trace");
		const step = lines.find((line) => line.msg === "service_step");
		expect(step).toMatchObject({
			traceId: "nested-trace",
			method: "chirp.posts.PostsService/GetPost",
		});
	});

	it("keeps concurrent requests' trace ids separate", async () => {
		const seen: (string | undefined)[] = [];
		const service = wrap(
			buildImpl(async () => {
				await new Promise((resolve) => setTimeout(resolve, 2));
				seen.push(getTraceId());
				return {};
			}),
		);

		await Promise.all([
			service.getPost({}, fakeCall({ "x-trace-id": "one" }).ctx),
			service.getPost({}, fakeCall({ "x-trace-id": "two" }).ctx),
		]);

		expect(seen.sort()).toEqual(["one", "two"]);
		expect(getTraceId()).toBeUndefined();
	});
});

describe("withTracing logging and compatibility", () => {
	it("logs a soft failure without changing the response body", async () => {
		const impl = buildImpl(async () => ({}));
		const service = wrap(impl);

		const response = await service.createPost({}, fakeCall().ctx);

		expect(response).toEqual(await impl.createPost({}));
		expect(rpcLines()).toEqual([
			expect.objectContaining({
				level: "warn",
				method: "chirp.posts.PostsService/CreatePost",
				code: "OK",
				outcome: "soft_failure",
				responseError: "Post content is required",
			}),
		]);
	});

	it("works when ctx is undefined", async () => {
		const service = wrap(buildImpl(async () => ({ id: "p1" })));

		await expect(service.getPost({})).resolves.toEqual({ id: "p1" });
		expect(rpcLines()[0]?.traceId).toMatch(UUID_PATTERN);
	});

	it("still reports the trace id when sending response headers throws", async () => {
		const { ctx } = fakeCall();
		vi.spyOn(ctx, "sendResponseHeaders").mockImplementation(() => {
			throw new Error("headers already sent");
		});
		const service = wrap(buildImpl(async () => ({})));

		await service.getPost({}, ctx);

		expect(ctx.trailers["x-trace-id"]).toMatch(UUID_PATTERN);
	});

	it("preserves the handler's `this` binding", async () => {
		const impl = {
			prefix: "post-",
			async getPost(this: { prefix: string }) {
				return { id: `${this.prefix}1` };
			},
		};

		const service = withTracing(PostsService, impl);

		await expect(service.getPost()).resolves.toEqual({ id: "post-1" });
	});
});
