import { makeLogger } from "./logger.js";
import { Webhooks } from "./webhooks.js";
import { Watcher } from "./watcher.js";
import { Downloader } from "./downloader.js";
import { PutSyncer } from "./put-syncer.js";

/**
 * @typedef MettreConfig
 * @property {Object} settings
 * @property {import('pino').Logger} logger
 * @property {("development","production","test")} mode
 */
const VALID_MODES = new Set(["development", "test", "production"]);
const validMode = (mode) => (VALID_MODES.has(mode) ? mode : "production");

export class Mettre {
	constructor(settings, arguedMode) {
		this.mode = validMode(arguedMode);
		this.settings = settings;
		this.logger = makeLogger(settings.log, this.mode);

		this.components = [];

		/** @type {PutSyncer} */
		this.putSyncer = this.#configure(PutSyncer);
		/** @type {Watcher} */
		this.watcher = this.#configure(Watcher);
		/** @type {Downloader} */
		this.downloader = this.#configure(Downloader);
		/** @type {Webhooks} */
		this.downloader = this.#configure(Webhooks);
	}
	#configure(Component) {
		const { name } = Component;
		const cmp = new Component({
			settings: this.settings[name],
			logger: this.logger.child({ name }),
			mode: this.mode,
		});
		this.components.push(cmp);
		return cmp;
	}
	async #runOnAll(method) {
		return Promise.all(this.components.map((cmp) => cmp[method]()));
	}
	async start() {
		const { watcher, putSyncer, downloader, webhooks } = this;
		watcher.on("dropped", (torrent) => putSyncer.submit(torrent));
		putSyncer.on("submitted", (torrent) => watcher.discard(torrent.filename));
		webhooks.on("transferred", (transfer) => putSyncer.findDownloads(transfer));
		putSyncer.on("downloadable", (asset) => downloader.enqueue(asset));
		downloader.on("complete", (asset) => putSyncer.release(asset));
		return this.#runOnAll("start");
	}
	async close() {
		return this.#runOnAll("close");
	}
}

/**
 * @param {object} settings
 * @param {string} arguedMode
 * @return {Mettre}
 */
export function createMettre(settings, arguedMode) {
	return new Mettre(settings, arguedMode);
}
