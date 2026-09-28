import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestFollow, createTestPost, createTestUser } from "../../tests/helpers";
import { db, schema } from "../db";
import { getUser, updateProfile } from "./users.service";

const { users } = schema;

describe("UsersService", () => {
	describe("getUser", () => {
		it("returns the user profile with counts", async () => {
			const user = await createTestUser();
			const follower1 = await createTestUser();
			const follower2 = await createTestUser();
			const followed = await createTestUser();
			await createTestFollow(follower1.id, user.id);
			await createTestFollow(follower2.id, user.id);
			await createTestFollow(user.id, followed.id);
			await createTestPost(user.id);
			await createTestPost(user.id);
			await createTestPost(user.id);

			const profile = await getUser(user.username);

			expect(profile.id).toBe(user.id);
			expect(profile.username).toBe(user.username);
			expect(profile.displayName).toBe(user.displayName);
			expect(profile.followerCount).toBe(2);
			expect(profile.followingCount).toBe(1);
			expect(profile.postCount).toBe(3);
		});

		it("does not expose the password hash", async () => {
			const user = await createTestUser();

			const profile = await getUser(user.username);

			expect(profile).not.toHaveProperty("passwordHash");
		});

		it("reports isFollowing true for a viewer who follows the user", async () => {
			const user = await createTestUser();
			const viewer = await createTestUser();
			await createTestFollow(viewer.id, user.id);

			const profile = await getUser(user.username, viewer.id);

			expect(profile.isFollowing).toBe(true);
		});

		it("reports isFollowing false for a viewer who does not follow the user", async () => {
			const user = await createTestUser();
			const viewer = await createTestUser();
			await createTestFollow(user.id, viewer.id);

			const profile = await getUser(user.username, viewer.id);

			expect(profile.isFollowing).toBe(false);
		});

		it("reports isFollowing false for anonymous viewers", async () => {
			const user = await createTestUser();
			const follower = await createTestUser();
			await createTestFollow(follower.id, user.id);

			const profile = await getUser(user.username);

			expect(profile.isFollowing).toBe(false);
		});

		it("reports isFollowing false when viewing own profile", async () => {
			const user = await createTestUser();

			const profile = await getUser(user.username, user.id);

			expect(profile.isFollowing).toBe(false);
		});

		it("throws for non-existent user", async () => {
			await expect(getUser("nonexistent")).rejects.toThrow("User not found");
		});
	});

	describe("updateProfile", () => {
		it("updates display name, bio and avatar", async () => {
			const user = await createTestUser();

			const result = await updateProfile({
				userId: user.id,
				displayName: "New Name",
				bio: "New bio",
				avatarUrl: "https://example.com/avatar.png",
			});

			expect(result.success).toBe(true);
			const profile = await getUser(user.username);
			expect(profile.displayName).toBe("New Name");
			expect(profile.bio).toBe("New bio");
			expect(profile.avatarUrl).toBe("https://example.com/avatar.png");
		});

		it("updates only the provided fields", async () => {
			const user = await createTestUser();
			await updateProfile({ userId: user.id, bio: "Original bio" });

			await updateProfile({ userId: user.id, displayName: "Renamed" });

			const profile = await getUser(user.username);
			expect(profile.displayName).toBe("Renamed");
			expect(profile.bio).toBe("Original bio");
		});

		it("succeeds without changes when no fields are given", async () => {
			const user = await createTestUser();

			const result = await updateProfile({ userId: user.id });

			expect(result.success).toBe(true);
			const profile = await getUser(user.username);
			expect(profile.displayName).toBe(user.displayName);
		});

		it("does not modify other users", async () => {
			const user = await createTestUser();
			const other = await createTestUser();

			await updateProfile({ userId: user.id, displayName: "Changed" });

			const row = await db.select().from(users).where(eq(users.id, other.id)).get();
			expect(row?.displayName).toBe(other.displayName);
		});
	});
});
