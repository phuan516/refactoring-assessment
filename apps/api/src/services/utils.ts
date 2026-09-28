import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Generate a simple ID
 */
export function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

const SCRYPT_PREFIX = "scrypt";
const SCRYPT_N = 2 ** 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

function scryptAsync(
	password: string,
	salt: Buffer,
	keylen: number,
	options: { N: number; r: number; p: number },
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password, salt, keylen, { ...options, maxmem: SCRYPT_MAXMEM }, (err, key) => {
			if (err) reject(err);
			else resolve(key);
		});
	});
}

/**
 * Hash a password with scrypt and a per-user random salt.
 * Format: scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>. Cost parameters are stored with
 * the hash so they can be raised later; needsRehash() flags hashes below the current cost.
 */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SCRYPT_SALT_BYTES);
	const key = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P,
	});
	return [
		SCRYPT_PREFIX,
		SCRYPT_N,
		SCRYPT_R,
		SCRYPT_P,
		salt.toString("base64"),
		key.toString("base64"),
	].join("$");
}

interface ParsedScryptHash {
	N: number;
	r: number;
	p: number;
	salt: Buffer;
	hash: Buffer;
}

function parseScryptHash(stored: string): ParsedScryptHash | null {
	const parts = stored.split("$");
	if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) return null;
	const [N, r, p] = parts.slice(1, 4).map(Number);
	if (![N, r, p].every((n) => Number.isSafeInteger(n) && n > 0)) return null;
	if (N > 2 ** 20 || r > 32 || p > 16) return null;
	const salt = Buffer.from(parts[4], "base64");
	const hash = Buffer.from(parts[5], "base64");
	if (salt.length === 0 || hash.length === 0 || hash.length > 256) return null;
	return { N, r, p, salt, hash };
}

/**
 * LEGACY - remove once no users.password_hash row matches /^[0-9a-f]{64}$/.
 * Unsalted-in-practice sha256(password + "salt") used before scrypt. Only used to
 * verify existing hashes so they can be upgraded on the next successful login.
 */
function legacySha256Hash(password: string): string {
	return createHash("sha256")
		.update(password + "salt")
		.digest("hex");
}

const LEGACY_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Verify a password against a stored hash (scrypt, or legacy sha256 during migration).
 * Comparison is constant-time; malformed hashes never verify.
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
	const parsed = parseScryptHash(hashedPassword);
	if (parsed) {
		try {
			const key = await scryptAsync(password, parsed.salt, parsed.hash.length, {
				N: parsed.N,
				r: parsed.r,
				p: parsed.p,
			});
			return timingSafeEqual(key, parsed.hash);
		} catch {
			return false;
		}
	}

	if (LEGACY_HASH_PATTERN.test(hashedPassword)) {
		const candidate = Buffer.from(legacySha256Hash(password), "hex");
		return timingSafeEqual(candidate, Buffer.from(hashedPassword, "hex"));
	}

	return false;
}

/**
 * True when a stored hash should be replaced (legacy format or below current cost).
 */
export function needsRehash(hashedPassword: string): boolean {
	const parsed = parseScryptHash(hashedPassword);
	if (!parsed) return true;
	return (
		parsed.N < SCRYPT_N ||
		parsed.r < SCRYPT_R ||
		parsed.p < SCRYPT_P ||
		parsed.hash.length < SCRYPT_KEYLEN
	);
}

/**
 * Convert Date to protobuf Timestamp
 */
export function toProtoTimestamp(date: Date): { seconds: bigint; nanos: number } {
	const ms = date.getTime();
	return {
		seconds: BigInt(Math.floor(ms / 1000)),
		nanos: (ms % 1000) * 1000000,
	};
}

/**
 * Convert protobuf Timestamp to Date
 */
export function fromProtoTimestamp(timestamp: { seconds: bigint; nanos: number }): Date {
	return new Date(Number(timestamp.seconds) * 1000 + timestamp.nanos / 1000000);
}
