import { classifyError } from "../errors";
import { getRequestContext } from "./context";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type LogFields = Record<string, unknown>;

export type LogSink = (line: string) => void;

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
	silent: 100,
};

function isLogLevel(value: string | undefined): value is LogLevel {
	return value !== undefined && Object.hasOwn(LEVEL_ORDER, value);
}

function envLevel(): LogLevel {
	const value = process.env.LOG_LEVEL;
	if (isLogLevel(value)) return value;
	// Keep unit-test output readable; tests that assert on logs install their own sink and level.
	return process.env.VITEST ? "silent" : "info";
}

const defaultSink: LogSink = (line) => {
	process.stdout.write(`${line}\n`);
};

let sink: LogSink = defaultSink;
let minLevel: LogLevel = envLevel();

/** Replace the output sink (tests). Returns a function restoring the previous sink. */
export function setLogSink(next: LogSink): () => void {
	const previous = sink;
	sink = next;
	return () => {
		sink = previous;
	};
}

export function setLogLevel(level: LogLevel): void {
	minLevel = level;
}

function serialiseError(value: unknown): unknown {
	if (value instanceof Error) {
		return { name: value.name, message: value.message, stack: value.stack };
	}
	return value;
}

type WriteLevel = Exclude<LogLevel, "silent">;

function write(level: WriteLevel, msg: string, fields?: LogFields): void {
	if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
	const context = getRequestContext();
	const entry: LogFields = {
		ts: new Date().toISOString(),
		level,
		msg,
		...(context
			? { traceId: context.traceId, method: context.method, userId: context.userId }
			: {}),
	};
	if (fields) {
		for (const [key, value] of Object.entries(fields)) {
			entry[key] = serialiseError(value);
		}
	}
	let line: string;
	try {
		line = JSON.stringify(entry);
	} catch {
		line = JSON.stringify({ ts: entry.ts, level, msg, logError: "unserialisable fields" });
	}
	sink(line);
}

export const logger = {
	debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
	info: (msg: string, fields?: LogFields) => write("info", msg, fields),
	warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
	error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};

/**
 * Log an error that a handler caught and converted into a response body
 * (`{ success: false, error }` or a default value) instead of rethrowing.
 * Client-caused errors log at info, anything unexpected at error with its stack.
 */
export function logCaughtError(msg: string, error: unknown): void {
	const classified = classifyError(error);
	const fields: LogFields = {
		code: classified.code,
		errorClass: classified.errorClass,
		errorMessage: classified.errorMessage,
	};
	if (classified.expected) {
		logger.info(msg, fields);
	} else {
		logger.error(msg, { ...fields, stack: error instanceof Error ? error.stack : undefined });
	}
}
