import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toProtoTimestamp } from "../../../services/utils";
import { notificationsHandler } from "../notifications.handler";

// Mock the notifications service
vi.mock("../../../services/notifications.service", () => ({
	createNotification: vi.fn(),
	getUserNotifications: vi.fn(),
	getUnreadCount: vi.fn(),
	markAsRead: vi.fn(),
	markAllAsRead: vi.fn(),
	deleteNotification: vi.fn(),
}));

// Mock the auth middleware
vi.mock("../../../middleware/auth", () => ({
	validateSessionToken: vi.fn(),
}));

import { validateSessionToken } from "../../../middleware/auth";
import {
	deleteNotification,
	getUnreadCount,
	getUserNotifications,
	markAllAsRead,
	markAsRead,
} from "../../../services/notifications.service";

describe("NotificationsHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	const mockValidSession = () => {
		vi.mocked(validateSessionToken).mockReturnValue({
			userId: "user-123",
			username: "testuser",
			role: "user",
		});
	};

	const mockInvalidSession = () => {
		vi.mocked(validateSessionToken).mockImplementation(() => {
			throw new Error("Invalid or expired session token");
		});
	};

	describe("getNotifications", () => {
		const createdAt = new Date("2024-01-15T10:30:00.123Z");

		it("maps notifications for the authenticated user", async () => {
			mockValidSession();
			vi.mocked(getUserNotifications).mockResolvedValue([
				{
					id: "notif-1",
					type: "comment",
					read: false,
					createdAt,
					postId: "post-1",
					commentId: "comment-1",
					actor: {
						id: "actor-1",
						username: "actor",
						displayName: "Actor",
						avatarUrl: "https://example.com/actor.png",
					},
					postContent: "The post",
					commentContent: "The comment",
				},
			]);

			const result = await notificationsHandler.getNotifications({
				sessionToken: "valid-token",
				limit: 10,
				offset: 5,
			});

			expect(validateSessionToken).toHaveBeenCalledWith("valid-token");
			expect(getUserNotifications).toHaveBeenCalledWith("user-123", 10, 5);
			expect(result).toEqual({
				notifications: [
					{
						id: "notif-1",
						type: "comment",
						read: false,
						actor: {
							id: "actor-1",
							username: "actor",
							displayName: "Actor",
							avatarUrl: "https://example.com/actor.png",
						},
						postId: "post-1",
						commentId: "comment-1",
						postContent: "The post",
						commentContent: "The comment",
						createdAt: toProtoTimestamp(createdAt),
					},
				],
			});
		});

		it("maps null optional fields to undefined", async () => {
			mockValidSession();
			vi.mocked(getUserNotifications).mockResolvedValue([
				{
					id: "notif-2",
					type: "follow",
					read: true,
					createdAt,
					postId: null,
					commentId: null,
					actor: { id: "actor-1", username: "actor", displayName: "Actor", avatarUrl: null },
					postContent: null,
					commentContent: null,
				},
				{
					id: "notif-3",
					type: "like",
					read: true,
					createdAt,
					postId: null,
					commentId: null,
					actor: null,
					postContent: null,
					commentContent: null,
				},
			] as never);

			const result = await notificationsHandler.getNotifications({
				sessionToken: "valid-token",
				limit: 20,
				offset: 0,
			});

			expect(result.notifications[0]).toEqual({
				id: "notif-2",
				type: "follow",
				read: true,
				actor: {
					id: "actor-1",
					username: "actor",
					displayName: "Actor",
					avatarUrl: undefined,
				},
				postId: undefined,
				commentId: undefined,
				postContent: undefined,
				commentContent: undefined,
				createdAt: toProtoTimestamp(createdAt),
			});
			expect(result.notifications[1].actor).toBeUndefined();
		});

		it("defaults pagination to limit 20 offset 0", async () => {
			mockValidSession();
			vi.mocked(getUserNotifications).mockResolvedValue([]);

			await notificationsHandler.getNotifications({
				sessionToken: "valid-token",
				limit: 0,
				offset: 0,
			});

			expect(getUserNotifications).toHaveBeenCalledWith("user-123", 20, 0);
		});

		it("returns an empty list for invalid session token", async () => {
			mockInvalidSession();

			const result = await notificationsHandler.getNotifications({
				sessionToken: "invalid-token",
				limit: 20,
				offset: 0,
			});

			expect(result).toEqual({ notifications: [] });
			expect(getUserNotifications).not.toHaveBeenCalled();
		});

		it("swallows service errors and returns an empty list", async () => {
			mockValidSession();
			vi.mocked(getUserNotifications).mockRejectedValue(new Error("Database error"));

			const result = await notificationsHandler.getNotifications({
				sessionToken: "valid-token",
				limit: 20,
				offset: 0,
			});

			expect(result).toEqual({ notifications: [] });
		});
	});

	describe("getUnreadCount", () => {
		it("returns the unread count for the authenticated user", async () => {
			mockValidSession();
			vi.mocked(getUnreadCount).mockResolvedValue({ count: 3 });

			const result = await notificationsHandler.getUnreadCount({ sessionToken: "valid-token" });

			expect(result).toEqual({ count: 3 });
			expect(getUnreadCount).toHaveBeenCalledWith("user-123");
		});

		it("returns zero for invalid session token", async () => {
			mockInvalidSession();

			const result = await notificationsHandler.getUnreadCount({ sessionToken: "invalid-token" });

			expect(result).toEqual({ count: 0 });
			expect(getUnreadCount).not.toHaveBeenCalled();
		});

		it("swallows service errors and returns zero", async () => {
			mockValidSession();
			vi.mocked(getUnreadCount).mockRejectedValue(new Error("Database error"));

			const result = await notificationsHandler.getUnreadCount({ sessionToken: "valid-token" });

			expect(result).toEqual({ count: 0 });
		});
	});

	describe("markAsRead", () => {
		it("marks a notification as read for the authenticated user", async () => {
			mockValidSession();
			vi.mocked(markAsRead).mockResolvedValue(undefined as never);

			const result = await notificationsHandler.markAsRead({
				sessionToken: "valid-token",
				notificationId: "notif-1",
			});

			expect(result).toEqual({ success: true });
			expect(markAsRead).toHaveBeenCalledWith("notif-1", "user-123");
		});

		it("returns error for invalid session token", async () => {
			mockInvalidSession();

			const result = await notificationsHandler.markAsRead({
				sessionToken: "invalid-token",
				notificationId: "notif-1",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Invalid or expired session token");
			expect(markAsRead).not.toHaveBeenCalled();
		});

		it("passes service error message through", async () => {
			mockValidSession();
			vi.mocked(markAsRead).mockRejectedValue(new Error("Notification not found"));

			const result = await notificationsHandler.markAsRead({
				sessionToken: "valid-token",
				notificationId: "missing",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Notification not found");
		});

		it("falls back to a generic message for non-Error rejections", async () => {
			mockValidSession();
			vi.mocked(markAsRead).mockRejectedValue("boom");

			const result = await notificationsHandler.markAsRead({
				sessionToken: "valid-token",
				notificationId: "notif-1",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Failed to mark as read");
		});
	});

	describe("markAllAsRead", () => {
		it("marks all notifications as read for the authenticated user", async () => {
			mockValidSession();
			vi.mocked(markAllAsRead).mockResolvedValue(undefined as never);

			const result = await notificationsHandler.markAllAsRead({ sessionToken: "valid-token" });

			expect(result).toEqual({ success: true });
			expect(markAllAsRead).toHaveBeenCalledWith("user-123");
		});

		it("returns error for invalid session token", async () => {
			mockInvalidSession();

			const result = await notificationsHandler.markAllAsRead({ sessionToken: "invalid-token" });

			expect(result.success).toBe(false);
			expect(result.error).toBe("Invalid or expired session token");
			expect(markAllAsRead).not.toHaveBeenCalled();
		});

		it("passes service error message through", async () => {
			mockValidSession();
			vi.mocked(markAllAsRead).mockRejectedValue(new Error("Database error"));

			const result = await notificationsHandler.markAllAsRead({ sessionToken: "valid-token" });

			expect(result.success).toBe(false);
			expect(result.error).toBe("Database error");
		});

		it("falls back to a generic message for non-Error rejections", async () => {
			mockValidSession();
			vi.mocked(markAllAsRead).mockRejectedValue("boom");

			const result = await notificationsHandler.markAllAsRead({ sessionToken: "valid-token" });

			expect(result.success).toBe(false);
			expect(result.error).toBe("Failed to mark all as read");
		});
	});

	describe("deleteNotification", () => {
		it("deletes a notification for the authenticated user", async () => {
			mockValidSession();
			vi.mocked(deleteNotification).mockResolvedValue(undefined as never);

			const result = await notificationsHandler.deleteNotification({
				sessionToken: "valid-token",
				notificationId: "notif-1",
			});

			expect(result).toEqual({ success: true });
			expect(deleteNotification).toHaveBeenCalledWith("notif-1", "user-123");
		});

		it("returns error for invalid session token", async () => {
			mockInvalidSession();

			const result = await notificationsHandler.deleteNotification({
				sessionToken: "invalid-token",
				notificationId: "notif-1",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Invalid or expired session token");
			expect(deleteNotification).not.toHaveBeenCalled();
		});

		it("passes service error message through", async () => {
			mockValidSession();
			vi.mocked(deleteNotification).mockRejectedValue(new Error("Notification not found"));

			const result = await notificationsHandler.deleteNotification({
				sessionToken: "valid-token",
				notificationId: "missing",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Notification not found");
		});

		it("falls back to a generic message for non-Error rejections", async () => {
			mockValidSession();
			vi.mocked(deleteNotification).mockRejectedValue("boom");

			const result = await notificationsHandler.deleteNotification({
				sessionToken: "valid-token",
				notificationId: "notif-1",
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Failed to delete notification");
		});
	});
});
