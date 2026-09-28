import { describe, expect, it } from "vitest";
import { createTestPost, createTestUser } from "../../tests/helpers";
import {
	createMentionNotifications,
	extractMentions,
	processMentions,
	validateMentionedUsers,
} from "./mentions.service";
import { getUserNotifications } from "./notifications.service";

describe("MentionsService", () => {
	describe("extractMentions", () => {
		it("extracts usernames without the @ symbol", () => {
			expect(extractMentions("hi @alice and @bob_2")).toEqual(["alice", "bob_2"]);
		});

		it("deduplicates repeated mentions", () => {
			expect(extractMentions("@alice @alice @alice")).toEqual(["alice"]);
		});

		it("stops at characters outside [a-zA-Z0-9_]", () => {
			expect(extractMentions("@alice-smith, @bob.")).toEqual(["alice", "bob"]);
		});

		it("returns empty array when there are no mentions", () => {
			expect(extractMentions("no mentions here @")).toEqual([]);
		});
	});

	describe("validateMentionedUsers", () => {
		it("maps existing usernames to ids and drops unknown ones", async () => {
			const alice = await createTestUser({ username: "alice" });
			const bob = await createTestUser({ username: "bob" });

			const result = await validateMentionedUsers(["alice", "bob", "ghost"]);

			expect(result.size).toBe(2);
			expect(result.get("alice")).toBe(alice.id);
			expect(result.get("bob")).toBe(bob.id);
			expect(result.has("ghost")).toBe(false);
		});

		it("returns empty map for empty input", async () => {
			const result = await validateMentionedUsers([]);

			expect(result.size).toBe(0);
		});
	});

	describe("createMentionNotifications", () => {
		it("creates mention notifications for each user except the actor", async () => {
			const actor = await createTestUser();
			const alice = await createTestUser();
			const bob = await createTestUser();
			const postId = await createTestPost(actor.id);

			await createMentionNotifications([alice.id, bob.id, actor.id], actor.id, postId);

			for (const recipient of [alice, bob]) {
				const list = await getUserNotifications(recipient.id);
				expect(list).toHaveLength(1);
				expect(list[0].type).toBe("mention");
				expect(list[0].actor?.id).toBe(actor.id);
				expect(list[0].postId).toBe(postId);
			}
			expect(await getUserNotifications(actor.id)).toHaveLength(0);
		});
	});

	describe("processMentions", () => {
		it("notifies mentioned existing users only", async () => {
			const actor = await createTestUser({ username: "actor" });
			const alice = await createTestUser({ username: "alice" });
			const bystander = await createTestUser({ username: "bystander" });
			const postId = await createTestPost(actor.id);

			await processMentions("hey @alice and @ghost", actor.id, postId);

			const aliceNotifications = await getUserNotifications(alice.id);
			expect(aliceNotifications).toHaveLength(1);
			expect(aliceNotifications[0].type).toBe("mention");
			expect(aliceNotifications[0].postId).toBe(postId);
			expect(await getUserNotifications(bystander.id)).toHaveLength(0);
		});

		it("does not notify on self-mention", async () => {
			const actor = await createTestUser({ username: "narcissus" });
			const postId = await createTestPost(actor.id);

			await processMentions("talking about @narcissus", actor.id, postId);

			expect(await getUserNotifications(actor.id)).toHaveLength(0);
		});

		it("creates a single notification when a user is mentioned repeatedly", async () => {
			const actor = await createTestUser({ username: "actor" });
			const alice = await createTestUser({ username: "alice" });

			await processMentions("@alice @alice @alice", actor.id);

			expect(await getUserNotifications(alice.id)).toHaveLength(1);
		});

		it("does nothing when content has no mentions", async () => {
			const actor = await createTestUser({ username: "actor" });
			const alice = await createTestUser({ username: "alice" });

			await processMentions("plain content", actor.id);

			expect(await getUserNotifications(alice.id)).toHaveLength(0);
		});
	});
});
