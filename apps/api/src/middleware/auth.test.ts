import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { createTestUser } from "../../tests/helpers";
import { db, schema } from "../db";

const TEST_SECRET = vi.hoisted(() => {
	const secret = "test-only-grpc-jwt-secret-0123456789abcdef";
	process.env.GRPC_JWT_SECRET = secret;
	return secret;
});

import { createSessionToken, requireAdmin, requireAuth, validateSessionToken } from "./auth";

const { users } = schema;

const OLD_PUBLIC_DEFAULT_SECRET = "chirp-grpc-jwt-secret-key-at-least-32-chars";
const VALID_CLAIMS = { issuer: "chirp-api", audience: "chirp-clients" } as const;

describe("session token middleware", () => {
	it("round-trips a token issued by createSessionToken", async () => {
		const user = await createTestUser({ username: "alice" });
		const token = createSessionToken({ userId: user.id, username: "alice", role: "user" });

		await expect(validateSessionToken(token)).resolves.toEqual({
			userId: user.id,
			username: "alice",
			role: "user",
		});
	});

	it("rejects a token signed with the old hard-coded default secret", async () => {
		const user = await createTestUser({ role: "admin" });
		const forged = jwt.sign(
			{ userId: user.id, username: user.username, role: "admin" },
			OLD_PUBLIC_DEFAULT_SECRET,
		);

		await expect(validateSessionToken(forged)).rejects.toThrow("Invalid or expired session token");
	});

	it("takes the role from the database, not from the token", async () => {
		const user = await createTestUser({ role: "user" });
		const token = jwt.sign(
			{ userId: user.id, username: "someone-else", role: "admin" },
			TEST_SECRET,
			{ algorithm: "HS256", ...VALID_CLAIMS, expiresIn: 60 },
		);

		const auth = await validateSessionToken(token);

		expect(auth.role).toBe("user");
		expect(auth.username).toBe(user.username);
		expect(() => requireAdmin(auth)).toThrow("Admin access required");
	});

	it("applies demotions immediately to already-issued tokens", async () => {
		const user = await createTestUser({ role: "admin" });
		const token = createSessionToken({ userId: user.id, username: user.username, role: "admin" });
		await db.update(users).set({ role: "user" }).where(eq(users.id, user.id));

		const auth = await validateSessionToken(token);

		expect(auth.role).toBe("user");
	});

	it("rejects tokens for nonexistent users", async () => {
		const token = createSessionToken({ userId: "ghost", username: "ghost", role: "admin" });

		await expect(validateSessionToken(token)).rejects.toThrow("Invalid or expired session token");
	});

	it("rejects tokens for banned users", async () => {
		const user = await createTestUser();
		const token = createSessionToken({ userId: user.id, username: user.username, role: "user" });
		await db
			.update(users)
			.set({ bannedAt: new Date(), bannedReason: "spam" })
			.where(eq(users.id, user.id));

		await expect(validateSessionToken(token)).rejects.toThrow("Invalid or expired session token");
	});

	it("rejects a different algorithm, wrong issuer, wrong audience and expired tokens", async () => {
		const user = await createTestUser();
		const payload = { userId: user.id, username: user.username, role: "user" };
		const tokens = [
			jwt.sign(payload, TEST_SECRET, { algorithm: "HS512", ...VALID_CLAIMS }),
			jwt.sign(payload, TEST_SECRET, {
				algorithm: "HS256",
				issuer: "evil",
				audience: "chirp-clients",
			}),
			jwt.sign(payload, TEST_SECRET, {
				algorithm: "HS256",
				issuer: "chirp-api",
				audience: "other",
			}),
			jwt.sign(payload, TEST_SECRET, { algorithm: "HS256" }),
			jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 10 }, TEST_SECRET, {
				algorithm: "HS256",
				...VALID_CLAIMS,
			}),
			jwt.sign(payload, "", { algorithm: "none" }),
		];

		for (const token of tokens) {
			await expect(validateSessionToken(token)).rejects.toThrow("Invalid or expired session token");
		}
	});

	it("requireAuth rejects a missing token", async () => {
		await expect(requireAuth(undefined)).rejects.toThrow("Authentication required");
	});
});
