import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
	AlreadyExistsError,
	NotFoundError,
	PermissionDeniedError,
	UnauthenticatedError,
} from "../errors";
import { type AuthContext, createSessionToken } from "../middleware/auth";
import { generateId, hashPassword, needsRehash, verifyPassword } from "./utils";

const { users } = schema;

export interface RegisterInput {
	email: string;
	username: string;
	displayName: string;
	password: string;
}

export interface LoginInput {
	email: string;
	password: string;
}

export async function registerUser(input: RegisterInput) {
	// Check if email already exists
	const existingEmail = await db.select().from(users).where(eq(users.email, input.email)).get();

	if (existingEmail) {
		throw new AlreadyExistsError("User with this email already exists");
	}

	// Check if username already exists
	const existingUsername = await db
		.select()
		.from(users)
		.where(eq(users.username, input.username))
		.get();

	if (existingUsername) {
		throw new AlreadyExistsError("Username already taken");
	}

	// Hash password
	const passwordHash = await hashPassword(input.password);

	// Create user
	const userId = generateId();
	await db.insert(users).values({
		id: userId,
		email: input.email,
		username: input.username,
		displayName: input.displayName,
		passwordHash,
		role: "user",
	});

	// Create session token
	const sessionToken = createSessionToken({
		userId,
		username: input.username,
		role: "user",
	});

	return { userId, sessionToken };
}

// Verified against when the email is unknown so both paths cost one scrypt verification.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
	if (!dummyHashPromise) {
		dummyHashPromise = hashPassword(randomBytes(16).toString("hex"));
	}
	return dummyHashPromise;
}

export async function loginUser(input: LoginInput) {
	// Find user by email
	const user = await db.select().from(users).where(eq(users.email, input.email)).get();

	if (!user) {
		await verifyPassword(input.password, await getDummyHash());
		throw new UnauthenticatedError("Invalid email or password");
	}

	// Verify password before revealing anything about the account (e.g. ban status)
	const valid = await verifyPassword(input.password, user.passwordHash);
	if (!valid) {
		throw new UnauthenticatedError("Invalid email or password");
	}

	// Check if user is banned
	if (user.bannedAt) {
		throw new PermissionDeniedError(`Account banned: ${user.bannedReason || "No reason provided"}`);
	}

	// Incremental migration: upgrade legacy / weaker hashes now that we have the plaintext.
	if (needsRehash(user.passwordHash)) {
		try {
			const passwordHash = await hashPassword(input.password);
			await db
				.update(users)
				.set({ passwordHash, updatedAt: new Date() })
				.where(eq(users.id, user.id));
		} catch (error) {
			console.error("Password rehash failed; login continues with existing hash", error);
		}
	}

	// Create session token
	const sessionToken = createSessionToken({
		userId: user.id,
		username: user.username,
		role: user.role as AuthContext["role"],
	});

	return { userId: user.id, sessionToken };
}

export async function getCurrentUser(userId: string) {
	const user = await db
		.select({
			id: users.id,
			email: users.email,
			username: users.username,
			displayName: users.displayName,
			avatarUrl: users.avatarUrl,
			bio: users.bio,
			role: users.role,
			createdAt: users.createdAt,
		})
		.from(users)
		.where(eq(users.id, userId))
		.get();

	if (!user) {
		throw new NotFoundError("User not found");
	}

	return user;
}
