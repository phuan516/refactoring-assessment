import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestComment, createTestPost, createTestUser } from "../../tests/helpers";
import { db, schema } from "../db";
import {
	createNotification,
	deleteNotification,
	getUnreadCount,
	getUserNotifications,
	markAllAsRead,
	markAsRead,
} from "./notifications.service";
import { generateId } from "./utils";

const { notifications } = schema;

async function insertNotification(
	userId: string,
	actorId: string,
	createdAt: Date,
	type = "like",
): Promise<string> {
	const id = generateId();
	await db.insert(notifications).values({ id, userId, actorId, type, createdAt });
	return id;
}

describe("NotificationsService", () => {
	describe("createNotification", () => {
		it("creates a notification for another user", async () => {
			const recipient = await createTestUser();
			const actor = await createTestUser();

			const result = await createNotification({
				userId: recipient.id,
				type: "follow",
				actorId: actor.id,
			});

			expect(result?.notificationId).toBeDefined();
			const list = await getUserNotifications(recipient.id);
			expect(list).toHaveLength(1);
			expect(list[0].type).toBe("follow");
			expect(list[0].read).toBe(false);
			expect(list[0].actor?.id).toBe(actor.id);
		});

		it("returns null and creates nothing for self-notification", async () => {
			const user = await createTestUser();

			const result = await createNotification({
				userId: user.id,
				type: "like",
				actorId: user.id,
			});

			expect(result).toBeNull();
			expect(await getUserNotifications(user.id)).toHaveLength(0);
		});
	});

	describe("getUserNotifications", () => {
		it("returns only the user's own notifications, newest first", async () => {
			const recipient = await createTestUser();
			const other = await createTestUser();
			const actor = await createTestUser();
			const oldest = await insertNotification(
				recipient.id,
				actor.id,
				new Date(Date.now() - 120_000),
			);
			const newest = await insertNotification(recipient.id, actor.id, new Date());
			const middle = await insertNotification(
				recipient.id,
				actor.id,
				new Date(Date.now() - 60_000),
			);
			await insertNotification(other.id, actor.id, new Date());

			const list = await getUserNotifications(recipient.id);

			expect(list.map((notification) => notification.id)).toEqual([newest, middle, oldest]);
		});

		it("includes actor details and post/comment content previews", async () => {
			const recipient = await createTestUser();
			const actor = await createTestUser();
			const postId = await createTestPost(recipient.id, "My post");
			const commentId = await createTestComment(postId, actor.id, "Nice post");

			await createNotification({
				userId: recipient.id,
				type: "comment",
				actorId: actor.id,
				postId,
				commentId,
			});

			const [notification] = await getUserNotifications(recipient.id);
			expect(notification.actor?.username).toBe(actor.username);
			expect(notification.actor?.displayName).toBe(actor.displayName);
			expect(notification.postId).toBe(postId);
			expect(notification.commentId).toBe(commentId);
			expect(notification.postContent).toBe("My post");
			expect(notification.commentContent).toBe("Nice post");
		});

		it("truncates content previews to 100 characters", async () => {
			const recipient = await createTestUser();
			const actor = await createTestUser();
			const postId = await createTestPost(recipient.id, "a".repeat(200));

			await createNotification({ userId: recipient.id, type: "like", actorId: actor.id, postId });

			const [notification] = await getUserNotifications(recipient.id);
			expect(notification.postContent).toBe("a".repeat(100));
			expect(notification.commentContent).toBeNull();
		});

		it("supports limit and offset", async () => {
			const recipient = await createTestUser();
			const actor = await createTestUser();
			const oldest = await insertNotification(
				recipient.id,
				actor.id,
				new Date(Date.now() - 120_000),
			);
			await insertNotification(recipient.id, actor.id, new Date(Date.now() - 60_000));
			await insertNotification(recipient.id, actor.id, new Date());

			const firstPage = await getUserNotifications(recipient.id, 2, 0);
			const secondPage = await getUserNotifications(recipient.id, 2, 2);

			expect(firstPage).toHaveLength(2);
			expect(secondPage.map((notification) => notification.id)).toEqual([oldest]);
		});
	});

	describe("getUnreadCount", () => {
		it("counts only unread notifications for the user", async () => {
			const recipient = await createTestUser();
			const other = await createTestUser();
			const actor = await createTestUser();
			const first = await insertNotification(recipient.id, actor.id, new Date());
			await insertNotification(recipient.id, actor.id, new Date());
			await insertNotification(recipient.id, actor.id, new Date());
			await insertNotification(other.id, actor.id, new Date());
			await markAsRead(first, recipient.id);

			const result = await getUnreadCount(recipient.id);

			expect(result.count).toBe(2);
		});

		it("returns zero when there are no notifications", async () => {
			const user = await createTestUser();

			const result = await getUnreadCount(user.id);

			expect(result.count).toBe(0);
		});
	});

	describe("markAsRead", () => {
		it("marks own notification as read", async () => {
			const recipient = await createTestUser();
			const actor = await createTestUser();
			const id = await insertNotification(recipient.id, actor.id, new Date());

			const result = await markAsRead(id, recipient.id);

			expect(result.success).toBe(true);
			const row = await db.select().from(notifications).where(eq(notifications.id, id)).get();
			expect(row?.read).toBe(true);
		});

		it("rejects marking another user's notification", async () => {
			const recipient = await createTestUser();
			const intruder = await createTestUser();
			const actor = await createTestUser();
			const id = await insertNotification(recipient.id, actor.id, new Date());

			await expect(markAsRead(id, intruder.id)).rejects.toThrow("Unauthorized");

			const row = await db.select().from(notifications).where(eq(notifications.id, id)).get();
			expect(row?.read).toBe(false);
		});

		it("throws for non-existent notification", async () => {
			const user = await createTestUser();

			await expect(markAsRead("nonexistent", user.id)).rejects.toThrow("Notification not found");
		});
	});

	describe("markAllAsRead", () => {
		it("marks all of the user's notifications read without touching others", async () => {
			const recipient = await createTestUser();
			const other = await createTestUser();
			const actor = await createTestUser();
			await insertNotification(recipient.id, actor.id, new Date());
			await insertNotification(recipient.id, actor.id, new Date());
			await insertNotification(other.id, actor.id, new Date());

			const result = await markAllAsRead(recipient.id);

			expect(result.success).toBe(true);
			expect((await getUnreadCount(recipient.id)).count).toBe(0);
			expect((await getUnreadCount(other.id)).count).toBe(1);
		});
	});

	describe("deleteNotification", () => {
		it("deletes own notification", async () => {
			const recipient = await createTestUser();
			const actor = await createTestUser();
			const id = await insertNotification(recipient.id, actor.id, new Date());

			const result = await deleteNotification(id, recipient.id);

			expect(result.success).toBe(true);
			expect(await getUserNotifications(recipient.id)).toHaveLength(0);
		});

		it("rejects deleting another user's notification", async () => {
			const recipient = await createTestUser();
			const intruder = await createTestUser();
			const actor = await createTestUser();
			const id = await insertNotification(recipient.id, actor.id, new Date());

			await expect(deleteNotification(id, intruder.id)).rejects.toThrow("Unauthorized");

			expect(await getUserNotifications(recipient.id)).toHaveLength(1);
		});

		it("throws for non-existent notification", async () => {
			const user = await createTestUser();

			await expect(deleteNotification("nonexistent", user.id)).rejects.toThrow(
				"Notification not found",
			);
		});
	});
});
