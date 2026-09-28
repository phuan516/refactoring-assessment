import { GetPostRequest, PostResponse } from "@chirp/proto";
import {
	Client,
	credentials,
	Metadata,
	type Server,
	type ServiceError,
	status,
} from "@grpc/grpc-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setLogLevel, setLogSink } from "../../observability/logger";
import { startGrpcServer } from "../server";

let server: Server;
let client: Client;
const logLines: Record<string, unknown>[] = [];

beforeAll(async () => {
	setLogSink((line) => logLines.push(JSON.parse(line)));
	setLogLevel("info");
	server = await startGrpcServer(0, "127.0.0.1");
	// grpc-js has no public accessor for the bound port; startGrpcServer logs it.
	const bound = logLines.find((line) => line.msg === "grpc_bound");
	client = new Client(`127.0.0.1:${bound?.port}`, credentials.createInsecure());
}, 30_000);

afterAll(() => {
	client?.close();
	server?.forceShutdown();
	setLogLevel("silent");
});

interface CallResult {
	error: ServiceError | null;
	response: PostResponse | undefined;
	headers: Metadata | undefined;
}

function getPost(postId: string, metadata = new Metadata()): Promise<CallResult> {
	return new Promise((resolve) => {
		let headers: Metadata | undefined;
		const call = client.makeUnaryRequest(
			"/chirp.posts.PostsService/GetPost",
			(req: GetPostRequest) => Buffer.from(GetPostRequest.toBinary(req)),
			(buf: Buffer) => PostResponse.fromBinary(buf),
			{ postId },
			metadata,
			(error, response) => resolve({ error, response, headers }),
		);
		call.on("metadata", (md: Metadata) => {
			headers = md;
		});
	});
}

describe("gRPC server (real transport)", () => {
	it("returns NOT_FOUND with the original message and a trace id for a missing post", async () => {
		const { error, headers } = await getPost("does-not-exist");

		expect(error?.code).toBe(status.NOT_FOUND);
		expect(error?.details).toBe("Post not found");
		const traceId = headers?.get("x-trace-id")[0];
		expect(traceId).toEqual(expect.any(String));
		expect(error?.metadata.get("x-trace-id")).toEqual([traceId]);
		expect(logLines.filter((line) => line.msg === "rpc" && line.traceId === traceId)).toEqual([
			expect.objectContaining({
				level: "warn",
				method: "chirp.posts.PostsService/GetPost",
				code: "NOT_FOUND",
				errorClass: "NotFoundError",
			}),
		]);
	});

	it("echoes a caller-supplied trace id", async () => {
		const metadata = new Metadata();
		metadata.set("x-trace-id", "integration-trace-1");

		const { headers, error } = await getPost("does-not-exist", metadata);

		expect(headers?.get("x-trace-id")).toEqual(["integration-trace-1"]);
		expect(error?.metadata.get("x-trace-id")).toEqual(["integration-trace-1"]);
	});
});
