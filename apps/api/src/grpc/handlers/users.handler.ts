import type { IUsersService } from "@chirp/proto";
import { errorMessage } from "../../errors";
import { validateSessionToken } from "../../middleware/auth";
import { logCaughtError } from "../../observability/logger";
import { getUser, updateProfile } from "../../services/users.service";
import { toProtoTimestamp } from "../../services/utils";

export const usersHandler: IUsersService = {
	async getUser(request) {
		let userId: string | undefined;
		if (request.sessionToken) {
			try {
				const auth = await validateSessionToken(request.sessionToken);
				userId = auth.userId;
			} catch {
				// Ignore invalid token for public access
			}
		}

		const user = await getUser(request.username, userId);

		return {
			id: user.id,
			email: user.email,
			username: user.username,
			displayName: user.displayName,
			avatarUrl: user.avatarUrl || undefined,
			bio: user.bio || undefined,
			role: user.role,
			createdAt: toProtoTimestamp(user.createdAt),
			followerCount: user.followerCount,
			followingCount: user.followingCount,
			postCount: user.postCount,
			isFollowing: user.isFollowing,
		};
	},

	async updateProfile(request) {
		try {
			const auth = await validateSessionToken(request.sessionToken);
			await updateProfile({
				userId: auth.userId,
				displayName: request.displayName || undefined,
				bio: request.bio || undefined,
				avatarUrl: request.avatarUrl || undefined,
			});

			return { success: true };
		} catch (error) {
			logCaughtError("handler_caught_error", error);
			return {
				success: false,
				error: errorMessage(error, "Failed to update profile"),
			};
		}
	},
};
