import type { IBookmarksService } from "@chirp/proto";
import { errorMessage } from "../../errors";
import { validateSessionToken } from "../../middleware/auth";
import { logCaughtError } from "../../observability/logger";
import {
	getBookmarkedPosts,
	getBookmarkStatus,
	toggleBookmark,
} from "../../services/bookmarks.service";
import { toProtoTimestamp } from "../../services/utils";

export const bookmarksHandler: IBookmarksService = {
	async toggleBookmark(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await toggleBookmark(request.postId, auth.userId);

			return {
				success: true,
				bookmarked: result.bookmarked,
			};
		} catch (error) {
			logCaughtError("handler_caught_error", error);
			return {
				success: false,
				bookmarked: false,
				error: errorMessage(error, "Failed to toggle bookmark"),
			};
		}
	},

	async getBookmarkStatus(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await getBookmarkStatus(request.postId, auth.userId);

			return { bookmarked: result.bookmarked };
		} catch (error) {
			logCaughtError("handler_swallowed_error", error);
			return { bookmarked: false };
		}
	},

	async getBookmarkedPosts(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const posts = await getBookmarkedPosts(
				auth.userId,
				auth.userId,
				request.limit || 20,
				request.offset || 0,
			);

			return {
				posts: posts.map((post) => ({
					id: post.id,
					content: post.content,
					createdAt: toProtoTimestamp(post.createdAt),
					updatedAt: toProtoTimestamp(post.updatedAt),
					author: post.author
						? {
								id: post.author.id,
								username: post.author.username,
								displayName: post.author.displayName,
								avatarUrl: post.author.avatarUrl || undefined,
							}
						: undefined,
					likeCount: post.likeCount,
					commentCount: post.commentCount,
					isLiked: post.isLiked,
				})),
			};
		} catch (error) {
			logCaughtError("handler_swallowed_error", error);
			return { posts: [] };
		}
	},
};
