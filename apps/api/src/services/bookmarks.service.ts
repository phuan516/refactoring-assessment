import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { NotFoundError } from "../errors";
import { hydratePosts, postSelection } from "./post-hydration";
import { generateId } from "./utils";

const { bookmarks, posts, users } = schema;

/**
 * Toggle bookmark for a post (create if not exists, delete if exists)
 */
export async function toggleBookmark(postId: string, userId: string) {
	// Verify post exists
	const post = await db.select().from(posts).where(eq(posts.id, postId)).get();

	if (!post) {
		throw new NotFoundError("Post not found");
	}

	// Check if already bookmarked
	const existingBookmark = await db
		.select()
		.from(bookmarks)
		.where(and(eq(bookmarks.postId, postId), eq(bookmarks.userId, userId)))
		.get();

	if (existingBookmark) {
		// Remove bookmark
		await db.delete(bookmarks).where(eq(bookmarks.id, existingBookmark.id));
		return { bookmarked: false };
	} else {
		// Add bookmark
		await db.insert(bookmarks).values({
			id: generateId(),
			postId,
			userId,
		});
		return { bookmarked: true };
	}
}

/**
 * Get bookmark status for a single post
 */
export async function getBookmarkStatus(postId: string, userId: string) {
	const bookmark = await db
		.select()
		.from(bookmarks)
		.where(and(eq(bookmarks.postId, postId), eq(bookmarks.userId, userId)))
		.get();

	return { bookmarked: !!bookmark };
}

/**
 * Get all bookmarked posts for a user with pagination
 */
export async function getBookmarkedPosts(
	userId: string,
	requesterId?: string,
	limit = 20,
	offset = 0,
) {
	const rows = await db
		.select(postSelection)
		.from(bookmarks)
		.leftJoin(posts, eq(bookmarks.postId, posts.id))
		.leftJoin(users, eq(posts.authorId, users.id))
		.where(eq(bookmarks.userId, userId))
		.orderBy(desc(bookmarks.createdAt))
		.limit(limit)
		.offset(offset);

	// A bookmark whose post no longer exists joins to all-null post columns; drop it.
	type BookmarkedPost = (typeof rows)[number] & {
		id: string;
		content: string;
		createdAt: Date;
		updatedAt: Date;
	};
	const existingPosts = rows.filter((row): row is BookmarkedPost => row.id !== null);

	return hydratePosts(existingPosts, requesterId);
}
