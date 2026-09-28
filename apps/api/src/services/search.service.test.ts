import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
	createTestComment,
	createTestLike,
	createTestPost,
	createTestUser,
} from "../../tests/helpers";
import { db, schema } from "../db";
import { searchPosts, searchUsers } from "./search.service";

const { posts } = schema;

describe("SearchService", () => {
	describe("searchPosts", () => {
		it("returns posts whose content contains the query", async () => {
			const user = await createTestUser();
			const match = await createTestPost(user.id, "I love TypeScript");
			await createTestPost(user.id, "Nothing to see here");

			const results = await searchPosts("TypeScript");

			expect(results.map((post) => post.id)).toEqual([match]);
			expect(results[0].author?.username).toBe(user.username);
		});

		it("matches case-insensitively", async () => {
			const user = await createTestUser();
			const match = await createTestPost(user.id, "Hello World");

			const results = await searchPosts("hello world");

			expect(results.map((post) => post.id)).toEqual([match]);
		});

		it("orders results newest first", async () => {
			const user = await createTestUser();
			const older = await createTestPost(user.id, "cats are great");
			const newer = await createTestPost(user.id, "cats are the best");
			await db
				.update(posts)
				.set({ createdAt: new Date(Date.now() - 60_000) })
				.where(eq(posts.id, older));

			const results = await searchPosts("cats");

			expect(results.map((post) => post.id)).toEqual([newer, older]);
		});

		it("includes like and comment counts and like status for the viewer", async () => {
			const author = await createTestUser();
			const viewer = await createTestUser();
			const postId = await createTestPost(author.id, "searchable post");
			await createTestLike(viewer.id, postId);
			await createTestComment(postId, author.id);

			const [forViewer] = await searchPosts("searchable", viewer.id);
			const [anonymous] = await searchPosts("searchable");

			expect(forViewer.likeCount).toBe(1);
			expect(forViewer.commentCount).toBe(1);
			expect(forViewer.isLiked).toBe(true);
			expect(anonymous.isLiked).toBe(false);
		});

		it("limits results to 50", async () => {
			const user = await createTestUser();
			for (let i = 0; i < 55; i++) {
				await createTestPost(user.id, `bulk post ${i}`);
			}

			const results = await searchPosts("bulk");

			expect(results).toHaveLength(50);
		});

		it("returns empty array when nothing matches", async () => {
			const user = await createTestUser();
			await createTestPost(user.id, "Some content");

			expect(await searchPosts("zzzznotfound")).toEqual([]);
		});

		it("returns empty array for blank queries", async () => {
			const user = await createTestUser();
			await createTestPost(user.id, "Some content");

			expect(await searchPosts("")).toEqual([]);
			expect(await searchPosts("   ")).toEqual([]);
		});
	});

	describe("searchUsers", () => {
		it("matches by username", async () => {
			const match = await createTestUser({ username: "alice_wonder" });
			await createTestUser({ username: "bob_builder" });

			const results = await searchUsers("alice");

			expect(results.map((user) => user.id)).toEqual([match.id]);
			expect(results[0].username).toBe("alice_wonder");
		});

		it("matches by display name", async () => {
			const match = await createTestUser({ username: "u_one", displayName: "Charlie Chaplin" });
			await createTestUser({ username: "u_two", displayName: "Someone Else" });

			const results = await searchUsers("Chaplin");

			expect(results.map((user) => user.id)).toEqual([match.id]);
		});

		it("matches case-insensitively", async () => {
			const match = await createTestUser({ username: "DaveSmith" });

			const results = await searchUsers("davesmith");

			expect(results.map((user) => user.id)).toEqual([match.id]);
		});

		it("does not match by email", async () => {
			await createTestUser({ username: "u_three", email: "secretmatch@example.com" });

			const results = await searchUsers("secretmatch");

			expect(results).toEqual([]);
		});

		it("returns public profile fields only", async () => {
			await createTestUser({ username: "profile_user" });

			const [result] = await searchUsers("profile_user");

			expect(Object.keys(result).sort()).toEqual(
				["avatarUrl", "bio", "displayName", "id", "username"].sort(),
			);
		});

		it("limits results to 20", async () => {
			for (let i = 0; i < 25; i++) {
				await createTestUser({ username: `crowd_${i}` });
			}

			const results = await searchUsers("crowd");

			expect(results).toHaveLength(20);
		});

		it("returns empty array when nothing matches", async () => {
			await createTestUser();

			expect(await searchUsers("zzzznotfound")).toEqual([]);
		});

		it("returns empty array for blank queries", async () => {
			await createTestUser();

			expect(await searchUsers("")).toEqual([]);
			expect(await searchUsers("   ")).toEqual([]);
		});
	});
});
