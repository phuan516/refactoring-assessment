import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "./utils";

// The pre-fix algorithm, reproduced here to build legacy hashes like the ones in existing DBs.
function legacyHash(password: string): string {
	return createHash("sha256")
		.update(password + "salt")
		.digest("hex");
}

describe("password hashing", () => {
	it("salts every hash, so equal passwords no longer produce equal hashes", async () => {
		const a = await hashPassword("password123");
		const b = await hashPassword("password123");

		expect(a).not.toBe(b);
		expect(a).not.toBe(legacyHash("password123"));
		expect(a.startsWith("scrypt$16384$8$1$")).toBe(true);
	});

	it("verifies the right password and rejects a wrong one", async () => {
		const stored = await hashPassword("correct horse");

		await expect(verifyPassword("correct horse", stored)).resolves.toBe(true);
		await expect(verifyPassword("wrong horse", stored)).resolves.toBe(false);
	});

	it("still verifies legacy sha256 hashes so existing users can log in and be upgraded", async () => {
		const stored = legacyHash("admin123");

		await expect(verifyPassword("admin123", stored)).resolves.toBe(true);
		await expect(verifyPassword("admin124", stored)).resolves.toBe(false);
	});

	it("flags legacy hashes for rehash but not current ones", async () => {
		expect(needsRehash(legacyHash("x"))).toBe(true);
		expect(needsRehash(await hashPassword("x"))).toBe(false);
		expect(needsRehash("scrypt$1024$8$1$c2FsdA==$aGFzaA==")).toBe(true);
	});

	it("never verifies malformed hashes", async () => {
		for (const stored of [
			"",
			"not-a-hash",
			"scrypt$abc$8$1$c2FsdA==$aGFzaA==",
			"scrypt$16384$8$1$$",
			"scrypt$16384$8$1$c2FsdA==",
			"ABCDEF",
		]) {
			await expect(verifyPassword("anything", stored)).resolves.toBe(false);
		}
	});
});
