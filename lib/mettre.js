import pino from "pino";
import { WebhookServer } from "./webhook-server.js";
import { Watcher } from "./torrent-watcher.js";
import { Downloader } from "./downloader.js";
import { PutSyncer } from "./put-syncer.js";
import { envProxy } from "./env-proxy.js";

const mapping = {
	webhooks: WebhookServer,
	watcher: Watcher,
	downloader: Downloader,
	putSyncer: PutSyncer,
};

/**
 * @typedef MettreConfig
 * @property {Object} settings
 * @property {import('pino').Logger} logger
 * @property {("development","production","test")} env
 */

const baseLogger = {
	redact: ["returned.config", "returned.headers", "returned.request"],
};

const envToLogger = {
	development: {
		...baseLogger,
		transport: {
			target: "pino-pretty",
			options: {
				translateTime: "HH:MM:ss Z",
				ignore: "pid,hostname",
			},
		},
	},
	production: baseLogger,
	test: false,
};

const VALID_ENVS = new Set(["development", "test", "production"]);
const validEnv = (env) => (VALID_ENVS.has(env) ? env : "production");

export async function mettre(envVars) {
	const settings = envProxy("mettre", envVars);
	const env = validEnv(envVars.NODE_ENV);
	const loggerConfig = envToLogger[env];
	if (loggerConfig) {
		Object.assign(loggerConfig, settings.log);
	}
	const logger = pino(loggerConfig);

	const pipeline = {};
	for (const [id, Constr] of Object.entries(mapping)) {
		pipeline[id] = new Constr({
			settings: settings[id],
			logger: logger.child({ name: Constr.name }),
			env,
		});
	}

	const { watcher, putSyncer, downloader, webhooks } = pipeline;

	watcher.on("dropped", (torrent) => putSyncer.submit(torrent));
	putSyncer.on("submitted", (torrent) => watcher.remove(torrent.filename));
	webhooks.on("transferred", (transfer) => putSyncer.finalize(transfer));
	putSyncer.on("downloadable", (download) => downloader.enqueue(download));
	downloader.on("complete", (status) => putSyncer.cleanup(status));

	const instances = Object.values(pipeline);
	return {
		...pipeline,
		start: () => Promise.all(instances.map((instance) => instance.start())),
		close: () => Promise.all(instances.map((instance) => instance.close())),
	};
}
