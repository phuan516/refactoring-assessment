import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
	traceId: string;
	method: string;
	userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
	return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
	return storage.getStore();
}

export function getTraceId(): string | undefined {
	return storage.getStore()?.traceId;
}

/** Attach the authenticated user to the current request's log context. No-op outside a request. */
export function setUserId(userId: string): void {
	const store = storage.getStore();
	if (store) store.userId = userId;
}
