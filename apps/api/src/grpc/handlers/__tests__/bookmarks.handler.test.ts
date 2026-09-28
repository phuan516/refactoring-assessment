import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toProtoTimestamp } from "../../../services/utils";
import { bookmarksHandler } from "../bookmarks.handler";

// Mock the bookmarks service
vi.mock("../../../services/bookmarks.service", () => ({
	toggleBookmark: vi.fn(),
	getBookmarkStatus: vi.fn(),
	getBookmarkedPosts: vi.fn(),
}));

// Mock the auth middleware
vi.mock("../../../middleware/auth", () => ({
	validateSessionToken: vi.fn(),
}));

import { validateSessionToken } from "../../../middleware/auth";
import {
	getBookmarkedPosts,
	getBookmarkStatus,
	toggleBookmark,
} from "../../../services/bookmarks.service";

describe("BookmarksHandler", () => {
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

	describe("toggleBookmark", () => {
		it("bookmarks a post for the authenticated user", async () => {
			mockValidSession();
			vi.mocked(toggleBookmark).mockResolvedValue({ bookmarked: true });

			const result = await bookmarksHandler.toggleBookmark({
				sessionToken: "valid-token",
				postId: "post-456",
			});

			expect(result).toEqual({ success: true, bookmarked: true });
			expect(validateSessionToken).toHaveBeenCalledWith("valid-token");
			expect(toggleBookmark).toHaveBeenCalledWith("post-456", "user-123");
		});

		it("removes a bookmark", async () => {
			mockValidSession();
			vi.mocked(toggleBookmark).mockResolvedValue({ bookmarked: false });

			const result = await bookmarksHandler.toggleBookmark({
				sessionToken: "valid-token",
				postId: "post-456",
			});

			expect(result).toEqual({ success: true, bookmarked: false });
		});

		it("returns error for invalid session token", async () => {
			mockInvalidSession();

			const result = await bookmarksHandler.toggleBookmark({
				sessionToken: "invalid-token",
				postId: "post-456",
			});

			expect(result.success).toBe(false);
			expect(result.bookmarked).toBe(false);
			expect(result.error).toBe("Invalid or expired session token");
			expect(toggleBookmark).not.toHaveBeenCalled();
		});

		it("passes service error message through", async () => {
			mockValidSession();
			vi.mocked(toggleBookmark).mockRejectedValue(new Error("Post not found"));

			const result = await bookmarksHandler.toggleBookmark({
				sessionToken: "valid-token",
				postId: "missing",
			});

			expect(result.success).toBe(false);
			expect(result.bookmarked).toBe(false);
			expect(result.error).toBe("Post not found");
		});

		it("falls back to a generic message for non-Error rejections", async () => {
			mockValidSession();
			vi.mocked(toggleBookmark).mockRejectedValue("boom");

			const result = await bookmarksHandler.toggleBookmark({
				sessionToken: "valid-token",
				postId: "post-456",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Failed to toggle bookmark");
		});
	});

	describe("getBookmarkStatus", () => {
		it("returns bookmark status for the authenticated user", async () => {
			mockValidSession();
			vi.mocked(getBookmarkStatus).mockResolvedValue({ bookmarked: true });

			const result = await bookmarksHandler.getBookmarkStatus({
				sessionToken: "valid-token",
				postId: "post-456",
			});

			expect(result).toEqual({ bookmarked: true });
			expect(getBookmarkStatus).toHaveBeenCalledWith("post-456", "user-123");
		});

		it("returns not bookmarked for invalid session token", async () => {
			mockInvalidSession();

			const result = await bookmarksHandler.getBookmarkStatus({
				sessionToken: "invalid-token",
				postId: "post-456",
			});

			expect(result).toEqual({ bookmarked: false });
			expect(getBookmarkStatus).not.toHaveBeenCalled();
		});

		it("swallows service errors and returns not bookmarked", async () => {
			mockValidSession();
			vi.mocked(getBookmarkStatus).mockRejectedValue(new Error("Database error"));

			const result = await bookmarksHandler.getBookmarkStatus({
				sessionToken: "valid-token",
				postId: "post-456",
			});

			expect(result).toEqual({ bookmarked: false });
		});
	});

	describe("getBookmarkedPosts", () => {
		const createdAt = new Date("2024-01-15T10:30:00.123Z");
		const updatedAt = new Date("2024-01-16T08:00:00.456Z");

		it("maps bookmarked posts for the authenticated user", async () => {
			mockValidSession();
			vi.mocked(getBookmarkedPosts).mockResolvedValue([
				{
					id: "post-1",
					content: "Saved post",
					createdAt,
					updatedAt,
					author: {
						id: "author-1",
						username: "author",
						displayName: "Author One",
						avatarUrl: "https://example.com/a.png",
					},
					likeCount: 3,
					commentCount: 1,
					isLiked: true,
				},
			]);

			const result = await bookmarksHandler.getBookmarkedPosts({
				sessionToken: "valid-token",
				limit: 5,
				offset: 10,
			});

			expect(getBookmarkedPosts).toHaveBeenCalledWith("user-123", "user-123", 5, 10);
			expect(result.posts).toEqual([
				{
					id: "post-1",
					content: "Saved post",
					createdAt: toProtoTimestamp(createdAt),
					updatedAt: toProtoTimestamp(updatedAt),
					author: {
						id: "author-1",
						username: "author",
						displayName: "Author One",
						avatarUrl: "https://example.com/a.png",
					},
					likeCount: 3,
					commentCount: 1,
					isLiked: true,
				},
			]);
		});

		it("defaults pagination to limit 20 offset 0", async () => {
			mockValidSession();
			vi.mocked(getBookmarkedPosts).mockResolvedValue([]);

			const result = await bookmarksHandler.getBookmarkedPosts({
				sessionToken: "valid-token",
				limit: 0,
				offset: 0,
			});

			expect(getBookmarkedPosts).toHaveBeenCalledWith("user-123", "user-123", 20, 0);
			expect(result).toEqual({ posts: [] });
		});

		it("maps a null avatar and a missing author to undefined", async () => {
			mockValidSession();
			vi.mocked(getBookmarkedPosts).mockResolvedValue([
				{
					id: "post-1",
					content: "With author",
					createdAt,
					updatedAt,
					author: { id: "a1", username: "a", displayName: "A", avatarUrl: null },
					likeCount: 0,
					commentCount: 0,
					isLiked: false,
				},
				{
					id: "post-2",
					content: "No author",
					createdAt,
					updatedAt,
					author: null,
					likeCount: 0,
					commentCount: 0,
					isLiked: false,
				},
			]);

			const result = await bookmarksHandler.getBookmarkedPosts({
				sessionToken: "valid-token",
				limit: 20,
				offset: 0,
			});

			expect(result.posts[0].author).toEqual({
				id: "a1",
				username: "a",
				displayName: "A",
				avatarUrl: undefined,
			});
			expect(result.posts[1].author).toBeUndefined();
		});

		it("returns empty list for invalid session token", async () => {
			mockInvalidSession();

			const result = await bookmarksHandler.getBookmarkedPosts({
				sessionToken: "invalid-token",
				limit: 20,
				offset: 0,
			});

			expect(result).toEqual({ posts: [] });
			expect(getBookmarkedPosts).not.toHaveBeenCalled();
		});

		it("swallows service errors and returns empty list", async () => {
			mockValidSession();
			vi.mocked(getBookmarkedPosts).mockRejectedValue(new Error("Database error"));

			const result = await bookmarksHandler.getBookmarkedPosts({
				sessionToken: "valid-token",
				limit: 20,
				offset: 0,
			});

			expect(result).toEqual({ posts: [] });
		});
	});
});
