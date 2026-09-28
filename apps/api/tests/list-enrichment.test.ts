import { describe, expect, it } from "vitest";
import { db, schema } from "../src/db";
import { getAuditLogs, listReports, listUsers } from "../src/services/admin.service";
import { getPostComments } from "../src/services/comments.service";
import { getUserNotifications } from "../src/services/notifications.service";
import {
	countQueries,
	createTestComment,
	createTestCommentLike,
	createTestPost,
	createTestUser,
	type TestUser,
} from "./helpers";

const T0 = 1_700_000_000;
const at = (offsetSeconds: number) => new Date((T0 + offsetSeconds) * 1000);

function author(user: TestUser) {
	return {
		id: user.id,
		username: user.username,
		displayName: user.displayName,
		avatarUrl: null,
	};
}

describe("getPostComments", () => {
	async function seedThread() {
		const alice = await createTestUser({ username: "alice" });
		const bob = await createTestUser({ username: "bob" });
		const carol = await createTestUser({ username: "carol" });
		const dave = await createTestUser({ username: "dave" });
		const postId = await createTestPost(bob.id, "a post");
		const otherPostId = await createTestPost(bob.id, "another post");

		const c1 = await createTestComment(postId, carol.id, "first");
		const r1 = await createTestComment(postId, bob.id, "reply one", c1);
		const c2 = await createTestComment(postId, dave.id, "second");
		const r2 = await createTestComment(postId, alice.id, "reply two", c1);
		await createTestComment(otherPostId, alice.id, "elsewhere");
		const c3 = await createTestComment(postId, alice.id, "third");
		const r3 = await createTestComment(postId, carol.id, "reply three", c3);

		await createTestCommentLike(alice.id, c1);
		await createTestCommentLike(bob.id, c1);
		await createTestCommentLike(bob.id, c2);
		await createTestCommentLike(alice.id, r2);
		await createTestCommentLike(carol.id, r3);

		const comment = (
			id: string,
			content: string,
			user: TestUser,
			parentId: string | null,
			likeCount: number,
			isLiked: boolean,
			replies: unknown[],
		) => ({
			id,
			content,
			createdAt: expect.any(Date),
			parentId,
			author: author(user),
			likeCount,
			isLiked,
			replies,
		});

		const expected = [
			comment(c1, "first", carol, null, 2, true, [
				comment(r1, "reply one", bob, c1, 0, false, []),
				comment(r2, "reply two", alice, c1, 1, true, []),
			]),
			comment(c2, "second", dave, null, 1, false, []),
			comment(c3, "third", alice, null, 0, false, [
				comment(r3, "reply three", carol, c3, 1, false, []),
			]),
		];

		return { alice, postId, expected };
	}

	it("returns top-level comments with nested replies, like counts and isLiked", async () => {
		const { alice, postId, expected } = await seedThread();

		const result = await getPostComments(postId, alice.id);

		expect(result).toStrictEqual(expected);
		expect(Object.keys(result[0])).toEqual([
			"id",
			"content",
			"createdAt",
			"parentId",
			"author",
			"likeCount",
			"isLiked",
			"replies",
		]);
		expect(Object.keys(result[0].replies[0])).toEqual(Object.keys(result[0]));
	});

	it("reports isLiked false for anonymous viewers", async () => {
		const { postId } = await seedThread();

		const result = await getPostComments(postId);

		expect(result.map((c) => c.isLiked)).toEqual([false, false, false]);
		expect(result[0].replies.map((r) => r.isLiked)).toEqual([false, false]);
		expect(result[0].likeCount).toBe(2);
	});

	it("returns an empty list for a post without comments", async () => {
		const user = await createTestUser();
		const postId = await createTestPost(user.id);

		expect(await getPostComments(postId, user.id)).toStrictEqual([]);
	});

	it("issues a constant number of queries as the thread grows", async () => {
		const user = await createTestUser();
		const postId = await createTestPost(user.id);
		const addComments = async (count: number) => {
			for (let i = 0; i < count; i++) {
				const commentId = await createTestComment(postId, user.id);
				await createTestComment(postId, user.id, "reply", commentId);
				await createTestCommentLike(user.id, commentId);
			}
		};

		await addComments(5);
		const small = await countQueries(() => getPostComments(postId, user.id));
		await addComments(5);
		const large = await countQueries(() => getPostComments(postId, user.id));

		expect(large.result).toHaveLength(10);
		expect(large.count).toBe(small.count);
		expect(large.count).toBeLessThanOrEqual(4);
	});
});

describe("admin lists", () => {
	it("listUsers adds post and comment counts per user", async () => {
		const alice = await createTestUser({ username: "alice" });
		const bob = await createTestUser({ username: "bob" });
		const postId = await createTestPost(alice.id);
		await createTestPost(alice.id);
		await createTestComment(postId, bob.id);
		await createTestComment(postId, bob.id);
		await createTestComment(postId, alice.id);

		const result = await listUsers();

		expect(result.total).toBe(2);
		const byName = Object.fromEntries(result.users.map((u) => [u.username, u]));
		expect(byName.alice).toMatchObject({ id: alice.id, postCount: 2, commentCount: 1 });
		expect(byName.bob).toMatchObject({ id: bob.id, postCount: 0, commentCount: 2 });
		expect(Object.keys(byName.alice)).toEqual([
			"id",
			"email",
			"username",
			"displayName",
			"avatarUrl",
			"bio",
			"role",
			"createdAt",
			"updatedAt",
			"bannedAt",
			"bannedReason",
			"postCount",
			"commentCount",
		]);
	});

	it("listUsers issues a constant number of queries as the page grows", async () => {
		const seed = async (count: number) => {
			for (let i = 0; i < count; i++) {
				const user = await createTestUser();
				const postId = await createTestPost(user.id);
				await createTestComment(postId, user.id);
			}
		};

		await seed(5);
		const small = await countQueries(() => listUsers());
		await seed(5);
		const large = await countQueries(() => listUsers());

		expect(large.result.users).toHaveLength(10);
		expect(large.count).toBe(small.count);
		expect(large.count).toBeLessThanOrEqual(4);
	});

	it("listReports resolves reporter usernames, newest first", async () => {
		const bob = await createTestUser({ username: "bob" });
		const carol = await createTestUser({ username: "carol" });
		await db.insert(schema.reports).values([
			{
				id: "r1",
				reporterId: carol.id,
				targetType: "post",
				targetId: "x",
				reason: "spam",
				createdAt: at(1),
			},
			{
				id: "r2",
				reporterId: bob.id,
				targetType: "user",
				targetId: "y",
				reason: "abuse",
				createdAt: at(2),
			},
			{
				id: "r3",
				reporterId: carol.id,
				targetType: "comment",
				targetId: "z",
				reason: "spam",
				createdAt: at(3),
			},
		]);

		const { reports, total } = await listReports();

		expect(total).toBe(3);
		expect(reports.map((r) => [r.id, r.reporterUsername])).toEqual([
			["r3", "carol"],
			["r2", "bob"],
			["r1", "carol"],
		]);
		expect(Object.keys(reports[0])).toEqual([
			"id",
			"reporterId",
			"targetType",
			"targetId",
			"reason",
			"description",
			"status",
			"reviewedBy",
			"reviewedAt",
			"createdAt",
			"reporterUsername",
		]);
	});

	it("listReports and getAuditLogs issue a constant number of queries", async () => {
		const seed = async (from: number, count: number) => {
			for (let i = from; i < from + count; i++) {
				const user = await createTestUser();
				await db.insert(schema.reports).values({
					id: `r${i}`,
					reporterId: user.id,
					targetType: "post",
					targetId: "x",
					reason: "spam",
				});
				await db.insert(schema.auditLogs).values({ id: `a${i}`, adminId: user.id, action: "x" });
			}
		};

		await seed(0, 5);
		const smallReports = await countQueries(() => listReports());
		const smallLogs = await countQueries(() => getAuditLogs());
		await seed(5, 5);
		const largeReports = await countQueries(() => listReports());
		const largeLogs = await countQueries(() => getAuditLogs());

		expect(largeReports.result.reports).toHaveLength(10);
		expect(largeLogs.result.logs).toHaveLength(10);
		expect(largeReports.count).toBe(smallReports.count);
		expect(largeLogs.count).toBe(smallLogs.count);
		expect(largeReports.count).toBeLessThanOrEqual(3);
		expect(largeLogs.count).toBeLessThanOrEqual(3);
	});

	it("getAuditLogs resolves admin usernames, newest first", async () => {
		const admin = await createTestUser({ username: "root", role: "admin" });
		const mod = await createTestUser({ username: "mod", role: "moderator" });
		await db.insert(schema.auditLogs).values([
			{ id: "a1", adminId: admin.id, action: "ban_user", createdAt: at(1) },
			{ id: "a2", adminId: mod.id, action: "review_report", createdAt: at(2) },
		]);

		const { logs, total } = await getAuditLogs();

		expect(total).toBe(2);
		expect(logs.map((l) => [l.id, l.adminUsername])).toEqual([
			["a2", "mod"],
			["a1", "root"],
		]);
		expect(Object.keys(logs[0])).toEqual([
			"id",
			"adminId",
			"action",
			"targetType",
			"targetId",
			"details",
			"ipAddress",
			"createdAt",
			"adminUsername",
		]);
	});
});

describe("getUserNotifications", () => {
	it("adds truncated post and comment previews", async () => {
		const alice = await createTestUser({ username: "alice" });
		const bob = await createTestUser({ username: "bob" });
		const longContent = "x".repeat(150);
		const postId = await createTestPost(alice.id, longContent);
		const commentId = await createTestComment(postId, bob.id, "nice post");
		await db.insert(schema.notifications).values([
			{ id: "n1", userId: alice.id, type: "like", actorId: bob.id, postId, createdAt: at(1) },
			{
				id: "n2",
				userId: alice.id,
				type: "comment",
				actorId: bob.id,
				postId,
				commentId,
				createdAt: at(2),
			},
			{ id: "n3", userId: alice.id, type: "follow", actorId: bob.id, createdAt: at(3) },
			{ id: "n4", userId: bob.id, type: "follow", actorId: alice.id, createdAt: at(4) },
		]);

		const result = await getUserNotifications(alice.id);

		expect(result).toStrictEqual([
			{
				id: "n3",
				type: "follow",
				read: false,
				createdAt: at(3),
				postId: null,
				commentId: null,
				actor: author(bob),
				postContent: null,
				commentContent: null,
			},
			{
				id: "n2",
				type: "comment",
				read: false,
				createdAt: at(2),
				postId,
				commentId,
				actor: author(bob),
				postContent: "x".repeat(100),
				commentContent: "nice post",
			},
			{
				id: "n1",
				type: "like",
				read: false,
				createdAt: at(1),
				postId,
				commentId: null,
				actor: author(bob),
				postContent: "x".repeat(100),
				commentContent: null,
			},
		]);
		expect(Object.keys(result[0])).toEqual([
			"id",
			"type",
			"read",
			"createdAt",
			"postId",
			"commentId",
			"actor",
			"postContent",
			"commentContent",
		]);
	});

	it("issues a constant number of queries as the page grows", async () => {
		const alice = await createTestUser();
		const bob = await createTestUser();
		const seed = async (from: number, count: number) => {
			for (let i = from; i < from + count; i++) {
				const postId = await createTestPost(alice.id);
				const commentId = await createTestComment(postId, bob.id);
				await db.insert(schema.notifications).values({
					id: `n${i}`,
					userId: alice.id,
					type: "comment",
					actorId: bob.id,
					postId,
					commentId,
				});
			}
		};

		await seed(0, 5);
		const small = await countQueries(() => getUserNotifications(alice.id));
		await seed(5, 5);
		const large = await countQueries(() => getUserNotifications(alice.id));

		expect(large.result).toHaveLength(10);
		expect(large.count).toBe(small.count);
		expect(large.count).toBeLessThanOrEqual(3);
	});
});
