import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followsHandler } from "../follows.handler";

// Mock the follows service
vi.mock("../../../services/follows.service", () => ({
	toggleFollow: vi.fn(),
	getFollowStatus: vi.fn(),
	getFollowerCount: vi.fn(),
	getFollowingCount: vi.fn(),
}));

// Mock the auth middleware
vi.mock("../../../middleware/auth", () => ({
	validateSessionToken: vi.fn(),
}));

import { validateSessionToken } from "../../../middleware/auth";
import {
	getFollowerCount,
	getFollowingCount,
	getFollowStatus,
	toggleFollow,
} from "../../../services/follows.service";

describe("FollowsHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	const mockValidSession = () => {
		vi.mocked(validateSessionToken).mockResolvedValue({
			userId: "user-123",
			username: "testuser",
			role: "user",
		});
	};

	const mockInvalidSession = () => {
		vi.mocked(validateSessionToken).mockImplementation(() => {
			throw new Error("Invalid or expired session token");
		});
	};

	describe("toggleFollow", () => {
		it("follows a user as the authenticated user", async () => {
			mockValidSession();
			vi.mocked(toggleFollow).mockResolvedValue({ following: true });

			const result = await followsHandler.toggleFollow({
				sessionToken: "valid-token",
				username: "alice",
			});

			expect(result).toEqual({ success: true, following: true });
			expect(validateSessionToken).toHaveBeenCalledWith("valid-token");
			expect(toggleFollow).toHaveBeenCalledWith("alice", "user-123");
		});

		it("unfollows a user", async () => {
			mockValidSession();
			vi.mocked(toggleFollow).mockResolvedValue({ following: false });

			const result = await followsHandler.toggleFollow({
				sessionToken: "valid-token",
				username: "alice",
			});

			expect(result).toEqual({ success: true, following: false });
		});

		it("returns error for invalid session token", async () => {
			mockInvalidSession();

			const result = await followsHandler.toggleFollow({
				sessionToken: "invalid-token",
				username: "alice",
			});

			expect(result.success).toBe(false);
			expect(result.following).toBe(false);
			expect(result.error).toBe("Invalid or expired session token");
			expect(toggleFollow).not.toHaveBeenCalled();
		});

		it("passes service error message through", async () => {
			mockValidSession();
			vi.mocked(toggleFollow).mockRejectedValue(new Error("Cannot follow yourself"));

			const result = await followsHandler.toggleFollow({
				sessionToken: "valid-token",
				username: "testuser",
			});

			expect(result.success).toBe(false);
			expect(result.following).toBe(false);
			expect(result.error).toBe("Cannot follow yourself");
		});

		it("falls back to a generic message for non-Error rejections", async () => {
			mockValidSession();
			vi.mocked(toggleFollow).mockRejectedValue("boom");

			const result = await followsHandler.toggleFollow({
				sessionToken: "valid-token",
				username: "alice",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Failed to toggle follow");
		});
	});

	describe("getFollowStatus", () => {
		it("returns follow status for the authenticated user", async () => {
			mockValidSession();
			vi.mocked(getFollowStatus).mockResolvedValue({ following: true });

			const result = await followsHandler.getFollowStatus({
				sessionToken: "valid-token",
				username: "alice",
			});

			expect(result).toEqual({ following: true });
			expect(getFollowStatus).toHaveBeenCalledWith("alice", "user-123");
		});

		it("returns not following for invalid session token", async () => {
			mockInvalidSession();

			const result = await followsHandler.getFollowStatus({
				sessionToken: "invalid-token",
				username: "alice",
			});

			expect(result).toEqual({ following: false });
			expect(getFollowStatus).not.toHaveBeenCalled();
		});

		it("swallows service errors and returns not following", async () => {
			mockValidSession();
			vi.mocked(getFollowStatus).mockRejectedValue(new Error("User not found"));

			const result = await followsHandler.getFollowStatus({
				sessionToken: "valid-token",
				username: "ghost",
			});

			expect(result).toEqual({ following: false });
		});
	});

	describe("getFollowerCount", () => {
		it("returns follower count without authentication", async () => {
			vi.mocked(getFollowerCount).mockResolvedValue({ count: 42 });

			const result = await followsHandler.getFollowerCount({ username: "alice" });

			expect(result).toEqual({ count: 42 });
			expect(getFollowerCount).toHaveBeenCalledWith("alice");
			expect(validateSessionToken).not.toHaveBeenCalled();
		});

		it("swallows service errors and returns zero", async () => {
			vi.mocked(getFollowerCount).mockRejectedValue(new Error("User not found"));

			const result = await followsHandler.getFollowerCount({ username: "ghost" });

			expect(result).toEqual({ count: 0 });
		});
	});

	describe("getFollowingCount", () => {
		it("returns following count without authentication", async () => {
			vi.mocked(getFollowingCount).mockResolvedValue({ count: 7 });

			const result = await followsHandler.getFollowingCount({ username: "alice" });

			expect(result).toEqual({ count: 7 });
			expect(getFollowingCount).toHaveBeenCalledWith("alice");
			expect(validateSessionToken).not.toHaveBeenCalled();
		});

		it("swallows service errors and returns zero", async () => {
			vi.mocked(getFollowingCount).mockRejectedValue(new Error("User not found"));

			const result = await followsHandler.getFollowingCount({ username: "ghost" });

			expect(result).toEqual({ count: 0 });
		});
	});
});
