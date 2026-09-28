import { and, eq, inArray, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db, schema } from "../db";

const { posts, users, likes, comments } = schema;

/*
 * Rule for list endpoints: fetch the page of rows in one query, then load
 * per-row data (counts, "did the viewer like it") with one batched query per
 * kind of data, keyed by the page's ids. Never issue queries inside
 * rows.map(...): that is an N+1 and costs one round trip per row.
 * tests/post-lists.test.ts asserts the query count stays constant as rows grow.
 */

export const postSelection = {
	id: posts.id,
	content: posts.content,
	createdAt: posts.createdAt,
	updatedAt: posts.updatedAt,
	author: {
		id: users.id,
		username: users.username,
		displayName: users.displayName,
		avatarUrl: users.avatarUrl,
	},
};

/**
 * Counts rows grouped by `column` for the given ids, in a single query.
 * Ids with no rows are absent from the map.
 */
export async function countBy(column: SQLiteColumn, ids: string[]): Promise<Map<string, number>> {
	if (ids.length === 0) {
		return new Map();
	}

	const rows = await db
		.select({ key: sql<string>`${column}`, count: sql<number>`count(*)` })
		.from(column.table)
		.where(inArray(column, ids))
		.groupBy(column);

	return new Map(rows.map((row) => [row.key, row.count]));
}

async function likedPostIds(viewerId: string, postIds: string[]): Promise<Set<string | null>> {
	const rows = await db
		.select({ postId: likes.postId })
		.from(likes)
		.where(and(eq(likes.userId, viewerId), inArray(likes.postId, postIds)));

	return new Set(rows.map((row) => row.postId));
}

/**
 * Adds likeCount, commentCount and isLiked to each post, preserving order.
 * Issues at most three queries, however many posts are passed.
 */
export async function hydratePosts<T extends { id: string }>(rows: T[], viewerId?: string) {
	if (rows.length === 0) {
		return [];
	}

	const ids = [...new Set(rows.map((row) => row.id))];

	const [likeCounts, commentCounts, liked] = await Promise.all([
		countBy(likes.postId, ids),
		countBy(comments.postId, ids),
		viewerId ? likedPostIds(viewerId, ids) : new Set<string | null>(),
	]);

	return rows.map((row) => ({
		...row,
		likeCount: likeCounts.get(row.id) || 0,
		commentCount: commentCounts.get(row.id) || 0,
		isLiked: liked.has(row.id),
	}));
}
