import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../errors";
import { runWithContext, setUserId } from "./context";
import { logCaughtError, logger, setLogLevel, setLogSink } from "./logger";

let lines: Record<string, unknown>[];
let restore: () => void;

beforeEach(() => {
	lines = [];
	restore = setLogSink((line) => lines.push(JSON.parse(line)));
	setLogLevel("debug");
});

afterEach(() => {
	restore();
	setLogLevel("silent");
});

describe("logger", () => {
	it("writes one JSON line with ts, level, msg and fields outside a request", () => {
		logger.info("hello", { answer: 42 });

		expect(lines).toEqual([{ ts: expect.any(String), level: "info", msg: "hello", answer: 42 }]);
	});

	it("adds request context fields inside a request, including a user set later", () => {
		runWithContext({ traceId: "t-1", method: "svc/M" }, () => {
			setUserId("user-9");
			logger.warn("inside");
		});

		expect(lines[0]).toMatchObject({ traceId: "t-1", method: "svc/M", userId: "user-9" });
	});

	it("serialises Error values", () => {
		logger.error("failed", { error: new Error("bad") });

		expect(lines[0]?.error).toMatchObject({ name: "Error", message: "bad" });
	});

	it("filters by level", () => {
		setLogLevel("warn");

		logger.info("dropped");
		logger.warn("kept");

		expect(lines.map((line) => line.msg)).toEqual(["kept"]);
	});

	it("does not throw on unserialisable fields", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;

		expect(() => logger.info("cyclic", { cyclic })).not.toThrow();
		expect(lines[0]).toMatchObject({ msg: "cyclic", logError: "unserialisable fields" });
	});
});

describe("logCaughtError", () => {
	it("logs client errors at info with their code", () => {
		logCaughtError("handler_caught_error", new NotFoundError("Post not found"));

		expect(lines[0]).toMatchObject({
			level: "info",
			msg: "handler_caught_error",
			code: "NOT_FOUND",
			errorClass: "NotFoundError",
			errorMessage: "Post not found",
		});
	});

	it("logs unexpected errors at error with a stack", () => {
		logCaughtError("handler_swallowed_error", new Error("db down"));

		expect(lines[0]).toMatchObject({ level: "error", code: "INTERNAL", errorMessage: "db down" });
		expect(lines[0]?.stack).toEqual(expect.stringContaining("db down"));
	});
});
