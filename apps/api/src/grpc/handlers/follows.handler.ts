import type { IFollowsService } from "@chirp/proto";
import { errorMessage } from "../../errors";
import { validateSessionToken } from "../../middleware/auth";
import { logCaughtError } from "../../observability/logger";
import {
	getFollowerCount,
	getFollowingCount,
	getFollowStatus,
	toggleFollow,
} from "../../services/follows.service";

export const followsHandler: IFollowsService = {
	async toggleFollow(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await toggleFollow(request.username, auth.userId);

			return {
				success: true,
				following: result.following,
			};
		} catch (error) {
			logCaughtError("handler_caught_error", error);
			return {
				success: false,
				following: false,
				error: errorMessage(error, "Failed to toggle follow"),
			};
		}
	},

	async getFollowStatus(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await getFollowStatus(request.username, auth.userId);

			return { following: result.following };
		} catch (error) {
			logCaughtError("handler_swallowed_error", error);
			return { following: false };
		}
	},

	async getFollowerCount(request) {
		try {
			const result = await getFollowerCount(request.username);
			return { count: result.count };
		} catch (error) {
			logCaughtError("handler_swallowed_error", error);
			return { count: 0 };
		}
	},

	async getFollowingCount(request) {
		try {
			const result = await getFollowingCount(request.username);
			return { count: result.count };
		} catch (error) {
			logCaughtError("handler_swallowed_error", error);
			return { count: 0 };
		}
	},
};
