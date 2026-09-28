/**
 * Typed application errors.
 *
 * Each class carries the gRPC status code name it should surface as. Messages are
 * part of the client contract (the web apps display them verbatim), so services
 * construct these with exactly the text they used to put in `new Error(...)`.
 *
 * This module deliberately has no imports from services or middleware: handler
 * tests `vi.mock` those modules with explicit factories, and the error classes
 * must stay real in that setting.
 */

export type RpcCode =
	| "INVALID_ARGUMENT"
	| "UNAUTHENTICATED"
	| "PERMISSION_DENIED"
	| "NOT_FOUND"
	| "ALREADY_EXISTS"
	| "FAILED_PRECONDITION"
	| "INTERNAL";

export class AppError extends Error {
	readonly code: RpcCode;

	constructor(message: string, code: RpcCode, options?: { cause?: unknown }) {
		super(message, options);
		this.name = new.target.name;
		this.code = code;
	}
}

export class InvalidArgumentError extends AppError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "INVALID_ARGUMENT", options);
	}
}

export class UnauthenticatedError extends AppError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "UNAUTHENTICATED", options);
	}
}

export class PermissionDeniedError extends AppError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "PERMISSION_DENIED", options);
	}
}

export class NotFoundError extends AppError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "NOT_FOUND", options);
	}
}

export class AlreadyExistsError extends AppError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "ALREADY_EXISTS", options);
	}
}

export class FailedPreconditionError extends AppError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "FAILED_PRECONDITION", options);
	}
}

export class InternalError extends AppError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, "INTERNAL", options);
	}
}

export const INTERNAL_MESSAGE = "Internal server error";

/**
 * TEMPORARY BRIDGE: middleware/auth.ts still throws plain `Error`s. Until it
 * throws typed errors, these exact messages are recognised so they surface with
 * the right status code and are not masked. Remove once the middleware migrates.
 */
const LEGACY_MESSAGE_CODES: Readonly<Record<string, RpcCode>> = {
	"Invalid or expired session token": "UNAUTHENTICATED",
	"Authentication required": "UNAUTHENTICATED",
	"Admin access required": "PERMISSION_DENIED",
	"Super admin access required": "PERMISSION_DENIED",
};

export interface ClassifiedError {
	code: RpcCode;
	/** Message safe to send to the client. */
	publicMessage: string;
	/** Class name of the original error, for logs. */
	errorClass: string;
	/** Original message, for logs only (may contain internals). */
	errorMessage: string;
	/** True when the client caused the failure (4xx-like). */
	expected: boolean;
}

export function classifyError(error: unknown): ClassifiedError {
	if (error instanceof AppError) {
		return {
			code: error.code,
			publicMessage: error.code === "INTERNAL" ? INTERNAL_MESSAGE : error.message,
			errorClass: error.name,
			errorMessage: error.message,
			expected: error.code !== "INTERNAL",
		};
	}
	if (error instanceof Error) {
		const legacyCode = LEGACY_MESSAGE_CODES[error.message];
		if (legacyCode) {
			return {
				code: legacyCode,
				publicMessage: error.message,
				errorClass: error.name,
				errorMessage: error.message,
				expected: true,
			};
		}
		return {
			code: "INTERNAL",
			publicMessage: INTERNAL_MESSAGE,
			errorClass: error.name,
			errorMessage: error.message,
			expected: false,
		};
	}
	return {
		code: "INTERNAL",
		publicMessage: INTERNAL_MESSAGE,
		errorClass: typeof error,
		errorMessage: String(error),
		expected: false,
	};
}

/**
 * Message for handlers that report failures in a `{ success: false, error }`
 * body. Preserves the historical contract: any Error's message passes through,
 * anything else becomes the per-RPC fallback.
 */
export function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}
