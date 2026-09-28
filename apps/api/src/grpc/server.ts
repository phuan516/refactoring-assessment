import {
	AdminService,
	AuthService,
	BookmarksService,
	CommentsService,
	FeedService,
	FollowsService,
	LikesService,
	NotificationsService,
	PostsService,
	SearchService,
	UsersService,
} from "@chirp/proto";
import { Server, ServerCredentials } from "@grpc/grpc-js";
import { adaptService } from "@protobuf-ts/grpc-backend";
import { logger } from "../observability/logger";
import { adminHandler } from "./handlers/admin.handler";
import { authHandler } from "./handlers/auth.handler";
import { bookmarksHandler } from "./handlers/bookmarks.handler";
import { commentsHandler } from "./handlers/comments.handler";
import { feedHandler } from "./handlers/feed.handler";
import { followsHandler } from "./handlers/follows.handler";
import { likesHandler } from "./handlers/likes.handler";
import { notificationsHandler } from "./handlers/notifications.handler";
import { postsHandler } from "./handlers/posts.handler";
import { searchHandler } from "./handlers/search.handler";
import { usersHandler } from "./handlers/users.handler";
import { withTracing } from "./with-tracing";

export function startGrpcServer(port: number, host = "0.0.0.0"): Promise<Server> {
	const server = new Server();

	// Register all service handlers. withTracing adds trace ids, status-code mapping and request logs.
	server.addService(...adaptService(AuthService, withTracing(AuthService, authHandler)));
	server.addService(...adaptService(PostsService, withTracing(PostsService, postsHandler)));
	server.addService(
		...adaptService(CommentsService, withTracing(CommentsService, commentsHandler)),
	);
	server.addService(...adaptService(LikesService, withTracing(LikesService, likesHandler)));
	server.addService(...adaptService(FollowsService, withTracing(FollowsService, followsHandler)));
	server.addService(...adaptService(FeedService, withTracing(FeedService, feedHandler)));
	server.addService(...adaptService(SearchService, withTracing(SearchService, searchHandler)));
	server.addService(...adaptService(UsersService, withTracing(UsersService, usersHandler)));
	server.addService(...adaptService(AdminService, withTracing(AdminService, adminHandler)));
	server.addService(
		...adaptService(NotificationsService, withTracing(NotificationsService, notificationsHandler)),
	);
	server.addService(
		...adaptService(BookmarksService, withTracing(BookmarksService, bookmarksHandler)),
	);

	return new Promise((resolve, reject) => {
		server.bindAsync(`${host}:${port}`, ServerCredentials.createInsecure(), (error, boundPort) => {
			if (error) {
				logger.error("grpc_bind_failed", { port, error });
				reject(error);
				return;
			}
			logger.info("grpc_bound", { port: boundPort });
			resolve(server);
		});
	});
}
