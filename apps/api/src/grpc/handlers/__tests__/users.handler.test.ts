import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toProtoTimestamp } from "../../../services/utils";
import { usersHandler } from "../users.handler";

// Mock the users service
vi.mock("../../../services/users.service", () => ({
	getUser: vi.fn(),
	updateProfile: vi.fn(),
}));

// Mock the auth middleware
vi.mock("../../../middleware/auth", () => ({
	validateSessionToken: vi.fn(),
}));

import { validateSessionToken } from "../../../middleware/auth";
import { getUser, updateProfile } from "../../../services/users.service";

describe("UsersHandler", () => {
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

	describe("getUser", () => {
		const createdAt = new Date("2024-01-15T10:30:00.123Z");

		const mockUser = {
			id: "user-456",
			email: "alice@example.com",
			username: "alice",
			displayName: "Alice",
			avatarUrl: "https://example.com/alice.png",
			bio: "Hello",
			role: "user",
			createdAt,
			followerCount: 10,
			followingCount: 5,
			postCount: 3,
			isFollowing: false,
		};

		it("returns the profile anonymously without a viewer id", async () => {
			vi.mocked(getUser).mockResolvedValue(mockUser as never);

			const result = await usersHandler.getUser({ username: "alice" });

			expect(validateSessionToken).not.toHaveBeenCalled();
			expect(getUser).toHaveBeenCalledWith("alice", undefined);
			expect(result).toEqual({
				id: "user-456",
				email: "alice@example.com",
				username: "alice",
				displayName: "Alice",
				avatarUrl: "https://example.com/alice.png",
				bio: "Hello",
				role: "user",
				createdAt: toProtoTimestamp(createdAt),
				followerCount: 10,
				followingCount: 5,
				postCount: 3,
				isFollowing: false,
			});
		});

		it("passes the viewer id when a valid session token is provided", async () => {
			mockValidSession();
			vi.mocked(getUser).mockResolvedValue({ ...mockUser, isFollowing: true } as never);

			const result = await usersHandler.getUser({
				username: "alice",
				sessionToken: "valid-token",
			});

			expect(validateSessionToken).toHaveBeenCalledWith("valid-token");
			expect(getUser).toHaveBeenCalledWith("alice", "user-123");
			expect(result.isFollowing).toBe(true);
		});

		it("ignores an invalid session token and loads the profile anonymously", async () => {
			mockInvalidSession();
			vi.mocked(getUser).mockResolvedValue(mockUser as never);

			const result = await usersHandler.getUser({
				username: "alice",
				sessionToken: "invalid-token",
			});

			expect(getUser).toHaveBeenCalledWith("alice", undefined);
			expect(result.id).toBe("user-456");
		});

		it("maps null avatar and bio to undefined", async () => {
			vi.mocked(getUser).mockResolvedValue({
				...mockUser,
				avatarUrl: null,
				bio: null,
			} as never);

			const result = await usersHandler.getUser({ username: "alice" });

			expect(result.avatarUrl).toBeUndefined();
			expect(result.bio).toBeUndefined();
		});

		it("propagates service errors such as user not found (no try/catch)", async () => {
			vi.mocked(getUser).mockRejectedValue(new Error("User not found"));

			await expect(usersHandler.getUser({ username: "ghost" })).rejects.toThrow("User not found");
		});
	});

	describe("updateProfile", () => {
		it("updates the authenticated user's profile", async () => {
			mockValidSession();
			vi.mocked(updateProfile).mockResolvedValue(undefined as never);

			const result = await usersHandler.updateProfile({
				sessionToken: "valid-token",
				displayName: "New Name",
				bio: "New bio",
				avatarUrl: "https://example.com/new.png",
			});

			expect(result).toEqual({ success: true });
			expect(validateSessionToken).toHaveBeenCalledWith("valid-token");
			expect(updateProfile).toHaveBeenCalledWith({
				userId: "user-123",
				displayName: "New Name",
				bio: "New bio",
				avatarUrl: "https://example.com/new.png",
			});
		});

		it("converts empty and missing fields to undefined", async () => {
			mockValidSession();
			vi.mocked(updateProfile).mockResolvedValue(undefined as never);

			await usersHandler.updateProfile({
				sessionToken: "valid-token",
				displayName: "",
			});

			expect(updateProfile).toHaveBeenCalledWith({
				userId: "user-123",
				displayName: undefined,
				bio: undefined,
				avatarUrl: undefined,
			});
		});

		it("returns error for invalid session token", async () => {
			mockInvalidSession();

			const result = await usersHandler.updateProfile({
				sessionToken: "invalid-token",
				displayName: "New Name",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Invalid or expired session token");
			expect(updateProfile).not.toHaveBeenCalled();
		});

		it("passes service error message through", async () => {
			mockValidSession();
			vi.mocked(updateProfile).mockRejectedValue(new Error("Display name too long"));

			const result = await usersHandler.updateProfile({
				sessionToken: "valid-token",
				displayName: "x".repeat(200),
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Display name too long");
		});

		it("falls back to a generic message for non-Error rejections", async () => {
			mockValidSession();
			vi.mocked(updateProfile).mockRejectedValue("boom");

			const result = await usersHandler.updateProfile({
				sessionToken: "valid-token",
				bio: "bio",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Failed to update profile");
		});
	});
});
