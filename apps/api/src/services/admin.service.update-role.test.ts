import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestUser } from "../../tests/helpers";
import { db, schema } from "../db";
import { updateUserRole } from "./admin.service";

const { users } = schema;

async function roleOf(userId: string) {
	const user = await db.select().from(users).where(eq(users.id, userId)).get();
	return user?.role;
}

describe("AdminService.updateUserRole", () => {
	it("lets an admin change a user's role", async () => {
		const admin = await createTestUser({ role: "admin" });
		const target = await createTestUser();

		await updateUserRole(target.id, "moderator", admin.id);

		expect(await roleOf(target.id)).toBe("moderator");
	});

	it("does not let a moderator promote themselves to admin", async () => {
		const moderator = await createTestUser({ role: "moderator" });

		await expect(updateUserRole(moderator.id, "admin", moderator.id)).rejects.toThrow(
			"Super admin access required",
		);
		expect(await roleOf(moderator.id)).toBe("moderator");
	});

	it("does not let a moderator change anyone else's role", async () => {
		const moderator = await createTestUser({ role: "moderator" });
		const target = await createTestUser();

		await expect(updateUserRole(target.id, "moderator", moderator.id)).rejects.toThrow(
			"Super admin access required",
		);
		expect(await roleOf(target.id)).toBe("user");
	});
});
