import { useSession } from "@tanstack/react-start/server";

export interface SessionData {
	userId: string;
	username: string;
	sessionToken: string;
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
const SESSION_SECRET = resolveSessionSecret("chirp-session-secret-key-at-least-32-chars");

export function useAppSession() {
	return useSession<SessionData>({
		password: SESSION_SECRET,
		name: "chirp-session",
		cookie: {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			maxAge: 60 * 60 * 24 * 7, // 7 days
		},
	});
}

export async function getSessionData(): Promise<SessionData | null> {
	const session = await useAppSession();
	// Cookies from before API-issued tokens have no sessionToken: treat as logged out.
	if (!session.data.userId || !session.data.sessionToken) {
		return null;
	}
	return session.data as SessionData;
}

export async function setSessionData(data: SessionData): Promise<void> {
	const session = await useAppSession();
	await session.update(data);
}

export async function clearSessionData(): Promise<void> {
	const session = await useAppSession();
	await session.clear();
}

export async function requireAuth(): Promise<SessionData> {
	const session = await getSessionData();
	if (!session) {
		throw new Error("Unauthorized");
	}
	return session;
}
