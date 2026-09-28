import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toProtoTimestamp } from "../../../services/utils";
import { feedHandler } from "../feed.handler";

// Mock the feed service
vi.mock("../../../services/feed.service", () => ({
	getHomeFeed: vi.fn(),
	getExploreFeed: vi.fn(),
}));

// Mock the auth middleware
vi.mock("../../../middleware/auth", () => ({
	validateSessionToken: vi.fn(),
}));

import { validateSessionToken } from "../../../middleware/auth";
import { getExploreFeed, getHomeFeed } from "../../../services/feed.service";

describe("FeedHandler", () => {
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

	const createdAt = new Date("2024-01-15T10:30:00.123Z");
	const updatedAt = new Date("2024-01-16T08:00:00.456Z");

	const mockPost = {
		id: "post-1",
		content: "Hello feed",
		createdAt,
		updatedAt,
		author: {
			id: "author-1",
			username: "author",
			displayName: "Author One",
			avatarUrl: "https://example.com/a.png",
		},
		likeCount: 4,
		commentCount: 2,
		isLiked: true,
	};

	const expectedPost = {
		id: "post-1",
		content: "Hello feed",
		createdAt: toProtoTimestamp(createdAt),
		updatedAt: toProtoTimestamp(updatedAt),
		author: {
			id: "author-1",
			username: "author",
			displayName: "Author One",
			avatarUrl: "https://example.com/a.png",
		},
		likeCount: 4,
		commentCount: 2,
		isLiked: true,
	};

	const sparsePost = {
		id: "post-2",
		content: "Sparse",
		createdAt,
		updatedAt,
		author: null,
	};

	const expectedSparsePost = {
		id: "post-2",
		content: "Sparse",
		createdAt: toProtoTimestamp(createdAt),
		updatedAt: toProtoTimestamp(updatedAt),
		author: { id: "", username: "", displayName: "" },
		likeCount: 0,
		commentCount: 0,
		isLiked: false,
	};

	describe("getHomeFeed", () => {
		it("returns the home feed for the authenticated user", async () => {
			mockValidSession();
			vi.mocked(getHomeFeed).mockResolvedValue([mockPost]);

			const result = await feedHandler.getHomeFeed({
				sessionToken: "valid-token",
				pagination: { limit: 10, offset: 30 },
			});

			expect(validateSessionToken).toHaveBeenCalledWith("valid-token");
			expect(getHomeFeed).toHaveBeenCalledWith("user-123", { limit: 10, offset: 30 });
			expect(result).toEqual({ posts: [expectedPost] });
		});

		it("defaults pagination to limit 20 offset 0 when omitted", async () => {
			mockValidSession();
			vi.mocked(getHomeFeed).mockResolvedValue([]);

			const result = await feedHandler.getHomeFeed({ sessionToken: "valid-token" });

			expect(getHomeFeed).toHaveBeenCalledWith("user-123", { limit: 20, offset: 0 });
			expect(result).toEqual({ posts: [] });
		});

		it("fills defaults for missing author, counts and like flag", async () => {
			mockValidSession();
			vi.mocked(getHomeFeed).mockResolvedValue([sparsePost] as never);

			const result = await feedHandler.getHomeFeed({ sessionToken: "valid-token" });

			expect(result.posts).toEqual([expectedSparsePost]);
		});

		it("maps a null avatar to undefined", async () => {
			mockValidSession();
			vi.mocked(getHomeFeed).mockResolvedValue([
				{ ...mockPost, author: { ...mockPost.author, avatarUrl: null } },
			]);

			const result = await feedHandler.getHomeFeed({ sessionToken: "valid-token" });

			expect(result.posts[0].author?.avatarUrl).toBeUndefined();
		});

		it("throws for invalid session token (no try/catch)", async () => {
			mockInvalidSession();

			await expect(feedHandler.getHomeFeed({ sessionToken: "invalid-token" })).rejects.toThrow(
				"Invalid or expired session token",
			);
			expect(getHomeFeed).not.toHaveBeenCalled();
		});

		it("propagates service errors (no try/catch)", async () => {
			mockValidSession();
			vi.mocked(getHomeFeed).mockRejectedValue(new Error("Database error"));

			await expect(feedHandler.getHomeFeed({ sessionToken: "valid-token" })).rejects.toThrow(
				"Database error",
			);
		});
	});

	describe("getExploreFeed", () => {
		it("returns the explore feed anonymously without a viewer id", async () => {
			vi.mocked(getExploreFeed).mockResolvedValue([mockPost]);

			const result = await feedHandler.getExploreFeed({
				pagination: { limit: 5, offset: 15 },
			});

			expect(validateSessionToken).not.toHaveBeenCalled();
			expect(getExploreFeed).toHaveBeenCalledWith({ limit: 5, offset: 15, userId: undefined });
			expect(result).toEqual({ posts: [expectedPost] });
		});

		it("passes the viewer id when a valid session token is provided", async () => {
			mockValidSession();
			vi.mocked(getExploreFeed).mockResolvedValue([mockPost]);

			await feedHandler.getExploreFeed({ sessionToken: "valid-token" });

			expect(validateSessionToken).toHaveBeenCalledWith("valid-token");
			expect(getExploreFeed).toHaveBeenCalledWith({ limit: 20, offset: 0, userId: "user-123" });
		});

		it("ignores an invalid session token and serves the feed anonymously", async () => {
			mockInvalidSession();
			vi.mocked(getExploreFeed).mockResolvedValue([mockPost]);

			const result = await feedHandler.getExploreFeed({ sessionToken: "invalid-token" });

			expect(getExploreFeed).toHaveBeenCalledWith({ limit: 20, offset: 0, userId: undefined });
			expect(result).toEqual({ posts: [expectedPost] });
		});

		it("does not validate an empty session token", async () => {
			vi.mocked(getExploreFeed).mockResolvedValue([]);

			await feedHandler.getExploreFeed({ sessionToken: "" });

			expect(validateSessionToken).not.toHaveBeenCalled();
			expect(getExploreFeed).toHaveBeenCalledWith({ limit: 20, offset: 0, userId: undefined });
		});

		it("fills defaults for missing author, counts and like flag", async () => {
			vi.mocked(getExploreFeed).mockResolvedValue([sparsePost] as never);

			const result = await feedHandler.getExploreFeed({});

			expect(result.posts).toEqual([expectedSparsePost]);
		});

		it("propagates service errors (no try/catch)", async () => {
			vi.mocked(getExploreFeed).mockRejectedValue(new Error("Database error"));

			await expect(feedHandler.getExploreFeed({})).rejects.toThrow("Database error");
		});
	});
});
