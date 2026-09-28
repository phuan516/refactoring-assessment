import { describe, expect, it } from "vitest";
import {
	AlreadyExistsError,
	AppError,
	classifyError,
	errorMessage,
	FailedPreconditionError,
	InternalError,
	InvalidArgumentError,
	NotFoundError,
	PermissionDeniedError,
	UnauthenticatedError,
} from "./errors";

describe("AppError subclasses", () => {
	it.each([
		[InvalidArgumentError, "INVALID_ARGUMENT"],
		[UnauthenticatedError, "UNAUTHENTICATED"],
		[PermissionDeniedError, "PERMISSION_DENIED"],
		[NotFoundError, "NOT_FOUND"],
		[AlreadyExistsError, "ALREADY_EXISTS"],
		[FailedPreconditionError, "FAILED_PRECONDITION"],
		[InternalError, "INTERNAL"],
	])("%o carries code %s, its name and the exact message", (ErrorClass, code) => {
		const error = new ErrorClass("Exact message");

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(AppError);
		expect(error.code).toBe(code);
		expect(error.name).toBe(ErrorClass.name);
		expect(error.message).toBe("Exact message");
	});

	it("keeps the cause", () => {
		const cause = new Error("root");

		expect(new InternalError("wrapped", { cause }).cause).toBe(cause);
	});
});

describe("classifyError", () => {
	it("exposes client errors unmasked", () => {
		expect(classifyError(new NotFoundError("Post not found"))).toEqual({
			code: "NOT_FOUND",
			publicMessage: "Post not found",
			errorClass: "NotFoundError",
			errorMessage: "Post not found",
			expected: true,
		});
	});

	it("masks InternalError and plain Errors", () => {
		expect(classifyError(new InternalError("secret"))).toMatchObject({
			code: "INTERNAL",
			publicMessage: "Internal server error",
			errorMessage: "secret",
			expected: false,
		});
		expect(classifyError(new TypeError("x is undefined"))).toMatchObject({
			code: "INTERNAL",
			publicMessage: "Internal server error",
			errorClass: "TypeError",
			errorMessage: "x is undefined",
			expected: false,
		});
	});

	it.each([
		["Invalid or expired session token", "UNAUTHENTICATED"],
		["Authentication required", "UNAUTHENTICATED"],
		["Admin access required", "PERMISSION_DENIED"],
		["Super admin access required", "PERMISSION_DENIED"],
	])("bridges legacy middleware message %j to %s", (message, code) => {
		expect(classifyError(new Error(message))).toMatchObject({
			code,
			publicMessage: message,
			expected: true,
		});
	});

	it("handles non-Error values", () => {
		expect(classifyError(undefined)).toMatchObject({
			code: "INTERNAL",
			publicMessage: "Internal server error",
			errorClass: "undefined",
		});
	});
});

describe("errorMessage", () => {
	it("passes through any Error's message", () => {
		expect(errorMessage(new NotFoundError("Post not found"), "fallback")).toBe("Post not found");
		expect(errorMessage(new Error("anything"), "fallback")).toBe("anything");
	});

	it("uses the fallback for non-Error values", () => {
		expect(errorMessage("string", "Registration failed")).toBe("Registration failed");
		expect(errorMessage(null, "Login failed")).toBe("Login failed");
	});
});
