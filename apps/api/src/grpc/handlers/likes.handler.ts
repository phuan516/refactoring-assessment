import type { ILikesService } from "@chirp/proto";
import { errorMessage } from "../../errors";
import { validateSessionToken } from "../../middleware/auth";
import { logCaughtError } from "../../observability/logger";
import {
	getCommentLikeStatus,
	getPostLikeStatus,
	toggleCommentLike,
	togglePostLike,
} from "../../services/likes.service";

export const likesHandler: ILikesService = {
	async togglePostLike(request) {
		try {
			const auth = await validateSessionToken(request.sessionToken);
			const result = await togglePostLike(request.postId, auth.userId);

			return {
				success: true,
				liked: result.liked,
			};
		} catch (error) {
			logCaughtError("handler_caught_error", error);
			return {
				success: false,
				liked: false,
				error: errorMessage(error, "Failed to toggle like"),
			};
		}
	},

	async toggleCommentLike(request) {
		try {
			const auth = await validateSessionToken(request.sessionToken);
			const result = await toggleCommentLike(request.commentId, auth.userId);

			return {
				success: true,
				liked: result.liked,
			};
		} catch (error) {
			logCaughtError("handler_caught_error", error);
			return {
				success: false,
				liked: false,
				error: errorMessage(error, "Failed to toggle like"),
			};
		}
	},

	async getPostLikeStatus(request) {
		try {
			const auth = await validateSessionToken(request.sessionToken);
			const result = await getPostLikeStatus(request.postId, auth.userId);

			return { liked: result.liked };
		} catch (error) {
			logCaughtError("handler_swallowed_error", error);
			return { liked: false };
		}
	},

	async getCommentLikeStatus(request) {
		try {
			const auth = await validateSessionToken(request.sessionToken);
			const result = await getCommentLikeStatus(request.commentId, auth.userId);

			return { liked: result.liked };
		} catch (error) {
			logCaughtError("handler_swallowed_error", error);
			return { liked: false };
		}
	},
};
