import { makeLogger } from "./logger.js";
import { WebhookServer } from "./webhooks.js";
import { Watcher } from "./watcher.js";
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

const VALID_ENVS = new Set(["development", "test", "production"]);
const validEnv = (env) => (VALID_ENVS.has(env) ? env : "production");

export async function mettre(envVars) {
	const settings = envProxy("mettre", envVars);
	const env = validEnv(envVars.NODE_ENV);
	const logger = makeLogger(settings.log, env);

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
