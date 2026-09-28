import { randomBytes } from "node:crypto";
import type { GrpcSessionPayload } from "@chirp/shared-types";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db, schema } from "../db";

const { users } = schema;

const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "chirp-api";
const JWT_AUDIENCE = "chirp-clients";
const MIN_SECRET_LENGTH = 32;

/**
 * Only the API signs and verifies session tokens; clients just carry the token the API
 * issued at login. In production a strong GRPC_JWT_SECRET is mandatory. Elsewhere, if it
 * is unset, a random per-process secret is used (sessions end when the API restarts).
 */
function resolveJwtSecret(): string {
	const configured = process.env.GRPC_JWT_SECRET;
	if (configured && configured.length >= MIN_SECRET_LENGTH) {
		return configured;
	}
	if (process.env.NODE_ENV === "production") {
		throw new Error(
			`GRPC_JWT_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production`,
		);
	}
	console.warn(
		`GRPC_JWT_SECRET is unset or shorter than ${MIN_SECRET_LENGTH} chars; using a random per-process secret (sessions reset on restart)`,
	);
	return randomBytes(48).toString("base64");
}

const JWT_SECRET = resolveJwtSecret();

export interface AuthContext {
	userId: string;
	username: string;
	role: "user" | "admin" | "moderator";
}

/**
 * Validates a session token and returns the auth context.
 * The token only proves which user id the API authenticated; username and role are
 * loaded from the database on every call so bans and role changes apply immediately.
 */
export async function validateSessionToken(token: string): Promise<AuthContext> {
	let userId: string;
	try {
		const decoded = jwt.verify(token, JWT_SECRET, {
			algorithms: [JWT_ALGORITHM],
			issuer: JWT_ISSUER,
			audience: JWT_AUDIENCE,
		}) as GrpcSessionPayload;
		userId = decoded.userId;
	} catch {
		throw new Error("Invalid or expired session token");
	}

	if (typeof userId !== "string" || userId.length === 0) {
		throw new Error("Invalid or expired session token");
	}

	const user = await db
		.select({
			id: users.id,
			username: users.username,
			role: users.role,
			bannedAt: users.bannedAt,
		})
		.from(users)
		.where(eq(users.id, userId))
		.get();

	if (!user || user.bannedAt) {
		throw new Error("Invalid or expired session token");
	}

	return {
		userId: user.id,
		username: user.username,
		role: user.role,
	};
}

/**
 * Creates a session token from auth context
 */
export function createSessionToken(
	context: AuthContext,
	expiresInSeconds: number = 7 * 24 * 60 * 60,
): string {
	return jwt.sign(
		{
			userId: context.userId,
			username: context.username,
			role: context.role,
		},
		JWT_SECRET,
		{
			algorithm: JWT_ALGORITHM,
			issuer: JWT_ISSUER,
			audience: JWT_AUDIENCE,
			expiresIn: expiresInSeconds,
		},
	);
}

/**
 * Requires authentication - throws if token is invalid
 */
export async function requireAuth(token: string | undefined): Promise<AuthContext> {
	if (!token) {
		throw new Error("Authentication required");
	}
	return validateSessionToken(token);
}

/**
 * Requires admin or moderator role
 */
export function requireAdmin(context: AuthContext): void {
	if (context.role !== "admin" && context.role !== "moderator") {
		throw new Error("Admin access required");
	}
}

/**
 * Requires admin role specifically
 */
export function requireSuperAdmin(context: AuthContext): void {
	if (context.role !== "admin") {
		throw new Error("Super admin access required");
	}
}
