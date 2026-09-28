import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toProtoTimestamp } from "../../../services/utils";
import { searchHandler } from "../search.handler";

// Mock the search service
vi.mock("../../../services/search.service", () => ({
	searchPosts: vi.fn(),
	searchUsers: vi.fn(),
}));

// Mock the auth middleware
vi.mock("../../../middleware/auth", () => ({
	validateSessionToken: vi.fn(),
}));

import { validateSessionToken } from "../../../middleware/auth";
import { searchPosts, searchUsers } from "../../../services/search.service";

describe("SearchHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	const mockValidSession = () => {
		vi.mocked(validateSessionToken).mockReturnValue({
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

	describe("searchPosts", () => {
		const createdAt = new Date("2024-01-15T10:30:00.123Z");
		const updatedAt = new Date("2024-01-16T08:00:00.456Z");

		const mockPost = {
			id: "post-1",
			content: "hello world",
			createdAt,
			updatedAt,
			author: {
				id: "author-1",
				username: "author",
				displayName: "Author One",
				avatarUrl: null,
			},
			likeCount: 2,
			commentCount: 1,
			isLiked: true,
		};

		it("searches anonymously without a viewer id", async () => {
			vi.mocked(searchPosts).mockResolvedValue([mockPost]);

			const result = await searchHandler.searchPosts({ query: "hello" });

			expect(validateSessionToken).not.toHaveBeenCalled();
			expect(searchPosts).toHaveBeenCalledWith("hello", undefined);
			expect(result).toEqual({
				posts: [
					{
						id: "post-1",
						content: "hello world",
						createdAt: toProtoTimestamp(createdAt),
						updatedAt: toProtoTimestamp(updatedAt),
						author: {
							id: "author-1",
							username: "author",
							displayName: "Author One",
							avatarUrl: undefined,
						},
						likeCount: 2,
						commentCount: 1,
						isLiked: true,
					},
				],
			});
		});

		it("passes the viewer id when a valid session token is provided", async () => {
			mockValidSession();
			vi.mocked(searchPosts).mockResolvedValue([]);

			const result = await searchHandler.searchPosts({
				query: "hello",
				sessionToken: "valid-token",
			});

			expect(validateSessionToken).toHaveBeenCalledWith("valid-token");
			expect(searchPosts).toHaveBeenCalledWith("hello", "user-123");
			expect(result).toEqual({ posts: [] });
		});

		it("ignores an invalid session token and searches anonymously", async () => {
			mockInvalidSession();
			vi.mocked(searchPosts).mockResolvedValue([mockPost]);

			const result = await searchHandler.searchPosts({
				query: "hello",
				sessionToken: "invalid-token",
			});

			expect(searchPosts).toHaveBeenCalledWith("hello", undefined);
			expect(result.posts).toHaveLength(1);
		});

		it("fills defaults for missing author, counts and like flag", async () => {
			vi.mocked(searchPosts).mockResolvedValue([
				{ id: "post-2", content: "sparse", createdAt, updatedAt, author: null },
			] as never);

			const result = await searchHandler.searchPosts({ query: "sparse" });

			expect(result.posts).toEqual([
				{
					id: "post-2",
					content: "sparse",
					createdAt: toProtoTimestamp(createdAt),
					updatedAt: toProtoTimestamp(updatedAt),
					author: { id: "", username: "", displayName: "" },
					likeCount: 0,
					commentCount: 0,
					isLiked: false,
				},
			]);
		});

		it("propagates service errors (no try/catch)", async () => {
			vi.mocked(searchPosts).mockRejectedValue(new Error("Database error"));

			await expect(searchHandler.searchPosts({ query: "hello" })).rejects.toThrow("Database error");
		});
	});

	describe("searchUsers", () => {
		it("maps matching users without authentication", async () => {
			vi.mocked(searchUsers).mockResolvedValue([
				{
					id: "user-1",
					username: "alice",
					displayName: "Alice",
					avatarUrl: "https://example.com/alice.png",
					bio: "Hi there",
				},
				{
					id: "user-2",
					username: "alicia",
					displayName: "Alicia",
					avatarUrl: null,
					bio: null,
				},
			]);

			const result = await searchHandler.searchUsers({ query: "ali" });

			expect(searchUsers).toHaveBeenCalledWith("ali");
			expect(validateSessionToken).not.toHaveBeenCalled();
			expect(result).toEqual({
				users: [
					{
						id: "user-1",
						username: "alice",
						displayName: "Alice",
						avatarUrl: "https://example.com/alice.png",
						bio: "Hi there",
					},
					{
						id: "user-2",
						username: "alicia",
						displayName: "Alicia",
						avatarUrl: undefined,
						bio: undefined,
					},
				],
			});
		});

		it("returns an empty list when nothing matches", async () => {
			vi.mocked(searchUsers).mockResolvedValue([]);

			const result = await searchHandler.searchUsers({ query: "zzz" });

			expect(result).toEqual({ users: [] });
		});

		it("propagates service errors (no try/catch)", async () => {
			vi.mocked(searchUsers).mockRejectedValue(new Error("Database error"));

			await expect(searchHandler.searchUsers({ query: "ali" })).rejects.toThrow("Database error");
		});
	});
});
