import { useSession } from "@tanstack/react-start/server";

export interface AdminSessionData {
	userId: string;
	username: string;
	role: "admin" | "moderator";
	// API-issued token; absent only on cookies written before this field existed.
	sessionToken?: string;
}

function resolveSessionSecret(devDefault: string): string {
	const configured = process.env.SESSION_SECRET;
	if (configured && configured.length >= 32) {
		return configured;
	}
	if (process.env.NODE_ENV === "production") {
		throw new Error("SESSION_SECRET must be set to at least 32 characters in production");
	}
	return devDefault;
}

// Required in production; the fallback is only for local development.
const SESSION_SECRET = resolveSessionSecret("chirp-admin-session-secret-key-at-least-32-chars");

export function useAdminSession() {
	return useSession<AdminSessionData>({
		password: SESSION_SECRET,
		name: "chirp-admin-session",
		cookie: {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			maxAge: 60 * 60 * 8, // 8 hours (shorter for admin)
		},
	});
}

export async function getAdminSessionData(): Promise<AdminSessionData | null> {
	const session = await useAdminSession();
	// Cookies from before API-issued tokens have no sessionToken: treat as logged out.
	if (!session.data.userId || !session.data.role || !session.data.sessionToken) {
		return null;
	}
	// Verify role is admin or moderator
	if (session.data.role !== "admin" && session.data.role !== "moderator") {
		return null;
	}
	return session.data as AdminSessionData;
}

export async function setAdminSessionData(data: Partial<AdminSessionData>): Promise<void> {
	const session = await useAdminSession();
	await session.update(data);
}

export async function clearAdminSessionData(): Promise<void> {
	const session = await useAdminSession();
	await session.clear();
}

export async function requireAdminAuth(): Promise<AdminSessionData> {
	const session = await getAdminSessionData();
	if (!session) {
		throw new Error("Admin access required");
	}
	return session;
}
