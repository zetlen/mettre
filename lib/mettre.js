import { makeLogger } from "./logger.js";
import { WebhookServer } from "./webhooks.js";
import { Watcher } from "./watcher.js";
import { Downloader } from "./downloader.js";
import { PutSyncer } from "./put-syncer.js";

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
 * @property {("development","production","test")} mode
 */

const VALID_MODES = new Set(["development", "test", "production"]);
const validMode = (mode) => (VALID_MODES.has(mode) ? mode : "production");

export async function mettre(settings, arguedMode) {
	const mode = validMode(arguedMode);
	const logger = makeLogger(settings.log, mode);

	const pipeline = {};
	for (const [id, Constr] of Object.entries(mapping)) {
		pipeline[id] = new Constr({
			settings: settings[id],
			logger: logger.child({ name: Constr.name }),
			mode,
		});
	}

	const { watcher, putSyncer, downloader, webhooks } = pipeline;

	watcher.on("dropped", (torrent) => putSyncer.submit(torrent));
	putSyncer.on("submitted", (torrent) => watcher.remove(torrent.filename));
	webhooks.on("transferred", (transfer) => putSyncer.download(transfer));
	putSyncer.on("downloadable", (asset) => downloader.enqueue(asset));
	downloader.on("complete", (asset) => putSyncer.release(asset));

	const instances = Object.values(pipeline);
	return {
		...pipeline,
		start: () => Promise.all(instances.map((instance) => instance.start())),
		close: () => Promise.all(instances.map((instance) => instance.close())),
	};
}
