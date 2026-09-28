import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { InvalidArgumentError, NotFoundError, PermissionDeniedError } from "../errors";
import { processMentions } from "./mentions.service";
import { createNotification } from "./notifications.service";
import { countBy } from "./post-hydration";
import { generateId } from "./utils";

const { comments, users, likes, posts } = schema;

export interface CreateCommentInput {
	postId: string;
	content: string;
	authorId: string;
	parentId?: string;
}

const commentSelection = {
	id: comments.id,
	content: comments.content,
	createdAt: comments.createdAt,
	parentId: comments.parentId,
	author: {
		id: users.id,
		username: users.username,
		displayName: users.displayName,
		avatarUrl: users.avatarUrl,
	},
};

async function likedCommentIds(viewerId: string, commentIds: string[]) {
	const rows = await db
		.select({ commentId: likes.commentId })
		.from(likes)
		.where(and(eq(likes.userId, viewerId), inArray(likes.commentId, commentIds)));

	return new Set(rows.map((row) => row.commentId));
}

export async function createComment(input: CreateCommentInput) {
	if (!input.content || input.content.length === 0) {
		throw new InvalidArgumentError("Comment content is required");
	}

	// Verify post exists
	const post = await db.select().from(posts).where(eq(posts.id, input.postId)).get();

	if (!post) {
		throw new NotFoundError("Post not found");
	}

	// If parentId provided, verify parent comment exists
	if (input.parentId) {
		const parentComment = await db
			.select()
			.from(comments)
			.where(eq(comments.id, input.parentId))
			.get();

		if (!parentComment) {
			throw new NotFoundError("Parent comment not found");
		}

		// Only allow one level of nesting
		if (parentComment.parentId) {
			throw new InvalidArgumentError("Cannot reply to a reply");
		}
	}

	const commentId = generateId();
	await db.insert(comments).values({
		id: commentId,
		content: input.content,
		postId: input.postId,
		authorId: input.authorId,
		parentId: input.parentId || null,
	});

	// Create notification for post author
	await createNotification({
		userId: post.authorId,
		type: "comment",
		actorId: input.authorId,
		postId: input.postId,
		commentId,
	});

	// Process mentions and create notifications
	await processMentions(input.content, input.authorId, input.postId, commentId);

	return { commentId };
}

export async function getPostComments(postId: string, userId?: string) {
	const topLevelComments = await db
		.select(commentSelection)
		.from(comments)
		.leftJoin(users, eq(comments.authorId, users.id))
		.where(and(eq(comments.postId, postId), isNull(comments.parentId)));

	if (topLevelComments.length === 0) {
		return [];
	}

	const replies = await db
		.select(commentSelection)
		.from(comments)
		.leftJoin(users, eq(comments.authorId, users.id))
		.where(
			inArray(
				comments.parentId,
				topLevelComments.map((comment) => comment.id),
			),
		);

	const commentIds = [...topLevelComments, ...replies].map((comment) => comment.id);
	const [likeCounts, liked] = await Promise.all([
		countBy(likes.commentId, commentIds),
		userId ? likedCommentIds(userId, commentIds) : new Set<string | null>(),
	]);

	const withLikeInfo = (comment: (typeof topLevelComments)[number]) => ({
		...comment,
		likeCount: likeCounts.get(comment.id) || 0,
		isLiked: liked.has(comment.id),
	});

	type Reply = ReturnType<typeof withLikeInfo> & { replies: never[] };
	const repliesByParent = new Map<string | null, Reply[]>();
	for (const reply of replies) {
		const siblings = repliesByParent.get(reply.parentId) ?? [];
		siblings.push({ ...withLikeInfo(reply), replies: [] });
		repliesByParent.set(reply.parentId, siblings);
	}

	return topLevelComments.map((comment) => ({
		...withLikeInfo(comment),
		replies: repliesByParent.get(comment.id) ?? [],
	}));
}

export async function deleteComment(commentId: string, userId: string) {
	const comment = await db.select().from(comments).where(eq(comments.id, commentId)).get();

	if (!comment) {
		throw new NotFoundError("Comment not found");
	}

	if (comment.authorId !== userId) {
		throw new PermissionDeniedError("You can only delete your own comments");
	}

	await db.delete(comments).where(eq(comments.id, commentId));

	return { success: true };
}
