import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, schema } from "../src/db";
import { getBookmarkedPosts } from "../src/services/bookmarks.service";
import { getExploreFeed, getHomeFeed } from "../src/services/feed.service";
import { getPost, getPosts, getUserPosts } from "../src/services/posts.service";
import { searchPosts } from "../src/services/search.service";
import {
	countQueries,
	createTestBookmark,
	createTestComment,
	createTestFollow,
	createTestLike,
	createTestPost,
	createTestUser,
	type TestUser,
} from "./helpers";

const T0 = 1_700_000_000;
const at = (offsetSeconds: number) => new Date((T0 + offsetSeconds) * 1000);

const POST_KEYS = [
	"id",
	"content",
	"createdAt",
	"updatedAt",
	"author",
	"likeCount",
	"commentCount",
	"isLiked",
];

function author(user: TestUser) {
	return {
		id: user.id,
		username: user.username,
		displayName: user.displayName,
		avatarUrl: null,
	};
}

/**
 * alice follows bob and carol; dave is not followed.
 * Posts (oldest first): p1 bob, p2 carol, p3 alice, p4 dave, p5 bob.
 */
async function seedFixture() {
	const alice = await createTestUser({ username: "alice" });
	const bob = await createTestUser({ username: "bob" });
	const carol = await createTestUser({ username: "carol" });
	const dave = await createTestUser({ username: "dave" });

	await createTestFollow(alice.id, bob.id);
	await createTestFollow(alice.id, carol.id);

	const p1 = await createTestPost(bob.id, "bob one", at(10));
	const p2 = await createTestPost(carol.id, "carol one", at(20));
	const p3 = await createTestPost(alice.id, "alice one", at(30));
	const p4 = await createTestPost(dave.id, "dave one", at(40));
	const p5 = await createTestPost(bob.id, "bob two", at(50));

	await createTestLike(alice.id, p1);
	await createTestLike(bob.id, p1);
	await createTestLike(alice.id, p2);
	await createTestLike(bob.id, p3);
	await createTestLike(dave.id, p4);
	await createTestLike(carol.id, p5);

	await createTestComment(p1, carol.id);
	await createTestComment(p1, dave.id);
	await createTestComment(p3, bob.id);
	await createTestComment(p4, alice.id);

	await createTestBookmark(alice.id, p4, at(100));
	await createTestBookmark(alice.id, p5, at(150));
	await createTestBookmark(alice.id, p1, at(200));

	const post = (id: string, content: string, u: TestUser, secs: number) => ({
		id,
		content,
		createdAt: at(secs),
		updatedAt: at(secs),
		author: author(u),
	});

	const expected = {
		p1: { ...post(p1, "bob one", bob, 10), likeCount: 2, commentCount: 2, isLiked: true },
		p2: { ...post(p2, "carol one", carol, 20), likeCount: 1, commentCount: 0, isLiked: true },
		p3: { ...post(p3, "alice one", alice, 30), likeCount: 1, commentCount: 1, isLiked: false },
		p4: { ...post(p4, "dave one", dave, 40), likeCount: 1, commentCount: 1, isLiked: false },
		p5: { ...post(p5, "bob two", bob, 50), likeCount: 1, commentCount: 0, isLiked: false },
	};

	return { alice, bob, carol, dave, expected };
}

const anonymous = <T extends { isLiked: boolean }>(items: T[]) =>
	items.map((item) => ({ ...item, isLiked: false }));

describe("post list queries: response shape", () => {
	it("getHomeFeed returns followed and own posts, newest first, with counts", async () => {
		const { alice, expected: e } = await seedFixture();

		const result = await getHomeFeed(alice.id);

		expect(result).toStrictEqual([e.p5, e.p3, e.p2, e.p1]);
		expect(Object.keys(result[0])).toEqual(POST_KEYS);
		expect(Object.keys(result[0].author ?? {})).toEqual([
			"id",
			"username",
			"displayName",
			"avatarUrl",
		]);
	});

	it("getHomeFeed honours limit and offset", async () => {
		const { alice, expected: e } = await seedFixture();

		expect(await getHomeFeed(alice.id, { limit: 2, offset: 1 })).toStrictEqual([e.p3, e.p2]);
	});

	it("getHomeFeed for a user with no posts and no follows is empty", async () => {
		await seedFixture();
		const loner = await createTestUser();

		expect(await getHomeFeed(loner.id)).toStrictEqual([]);
	});

	it("getUserPosts returns the author's posts for a viewer and anonymously", async () => {
		const { alice, expected: e } = await seedFixture();

		expect(await getUserPosts("bob", alice.id)).toStrictEqual([e.p5, e.p1]);
		expect(await getUserPosts("bob")).toStrictEqual(anonymous([e.p5, e.p1]));
	});

	it("getUserPosts for a user without posts is empty", async () => {
		await seedFixture();
		const quiet = await createTestUser({ username: "quiet" });

		expect(await getUserPosts(quiet.username, quiet.id)).toStrictEqual([]);
	});

	it("getBookmarkedPosts orders by bookmark time, not post time", async () => {
		const { alice, expected: e } = await seedFixture();

		const result = await getBookmarkedPosts(alice.id, alice.id);

		expect(result).toStrictEqual([e.p1, e.p5, e.p4]);
		expect(Object.keys(result[0])).toEqual(POST_KEYS);
	});

	it("getBookmarkedPosts without a requester reports isLiked false", async () => {
		const { alice, expected: e } = await seedFixture();

		expect(await getBookmarkedPosts(alice.id)).toStrictEqual(anonymous([e.p1, e.p5, e.p4]));
	});

	it("getBookmarkedPosts honours limit and offset", async () => {
		const { alice, expected: e } = await seedFixture();

		expect(await getBookmarkedPosts(alice.id, alice.id, 2, 1)).toStrictEqual([e.p5, e.p4]);
	});

	it("getBookmarkedPosts reports isLiked for the requester, not the bookmark owner", async () => {
		const { alice, bob, expected: e } = await seedFixture();

		expect(await getBookmarkedPosts(alice.id, bob.id)).toStrictEqual([
			{ ...e.p1, isLiked: true },
			{ ...e.p5, isLiked: false },
			{ ...e.p4, isLiked: false },
		]);
	});

	it("getBookmarkedPosts skips bookmarks whose post was deleted", async () => {
		const { alice, expected: e } = await seedFixture();
		await db.delete(schema.posts).where(eq(schema.posts.id, e.p5.id));

		expect(await getBookmarkedPosts(alice.id, alice.id)).toStrictEqual([e.p1, e.p4]);
	});

	it("getBookmarkedPosts for a user without bookmarks is empty", async () => {
		const { bob } = await seedFixture();

		expect(await getBookmarkedPosts(bob.id, bob.id)).toStrictEqual([]);
	});

	it("getExploreFeed and getPosts return every post, newest first", async () => {
		const { alice, expected: e } = await seedFixture();
		const all = [e.p5, e.p4, e.p3, e.p2, e.p1];

		expect(await getExploreFeed({ userId: alice.id })).toStrictEqual(all);
		expect(await getExploreFeed()).toStrictEqual(anonymous(all));
		expect(await getPosts({ userId: alice.id, limit: 3, offset: 1 })).toStrictEqual(
			all.slice(1, 4),
		);
	});

	it("searchPosts matches content and hydrates counts", async () => {
		const { alice, expected: e } = await seedFixture();

		expect(await searchPosts("one", alice.id)).toStrictEqual([e.p4, e.p3, e.p2, e.p1]);
		expect(await searchPosts("two")).toStrictEqual(anonymous([e.p5]));
	});

	it("getPost returns a single hydrated post", async () => {
		const { alice, expected: e } = await seedFixture();

		expect(await getPost(e.p1.id, alice.id)).toStrictEqual(e.p1);
		expect(await getPost(e.p1.id)).toStrictEqual({ ...e.p1, isLiked: false });
	});
});

/**
 * Guard against N+1 regressions: the number of SQL statements a list query
 * issues must not grow with the number of rows it returns.
 */
describe("post list queries: query count is constant in page size", () => {
	async function seedPosts(count: number) {
		const viewer = await createTestUser();
		const author = await createTestUser();
		await createTestFollow(viewer.id, author.id);
		for (let i = 0; i < count; i++) {
			const postId = await createTestPost(author.id, `post ${i}`, at(i));
			await createTestLike(viewer.id, postId);
			await createTestComment(postId, viewer.id);
			await createTestBookmark(viewer.id, postId, at(i));
		}
		return { viewer, author };
	}

	const operations: [string, (viewerId: string, authorName: string) => Promise<unknown[]>][] = [
		["getHomeFeed", (viewerId) => getHomeFeed(viewerId, { limit: 50 })],
		["getUserPosts", (viewerId, authorName) => getUserPosts(authorName, viewerId)],
		["getBookmarkedPosts", (viewerId) => getBookmarkedPosts(viewerId, viewerId, 50)],
		["getExploreFeed", (viewerId) => getExploreFeed({ userId: viewerId, limit: 50 })],
		["getPosts", (viewerId) => getPosts({ userId: viewerId, limit: 50 })],
		["searchPosts", (viewerId) => searchPosts("post", viewerId)],
	];

	it.each(operations)("%s issues at most 5 queries regardless of row count", async (_, run) => {
		const { viewer, author } = await seedPosts(10);
		const small = await countQueries(() => run(viewer.id, author.username));

		for (let i = 10; i < 20; i++) {
			const postId = await createTestPost(author.id, `post ${i}`, at(i));
			await createTestLike(viewer.id, postId);
			await createTestBookmark(viewer.id, postId, at(i));
		}
		const large = await countQueries(() => run(viewer.id, author.username));

		expect(small.result).toHaveLength(10);
		expect(large.result).toHaveLength(20);
		expect(large.count).toBe(small.count);
		expect(large.count).toBeLessThanOrEqual(5);
	});
});
