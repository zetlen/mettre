import path from "path";
import chokidar from "chokidar";
import { readFile, unlink as trash } from "node:fs/promises";
import { EventEmitter } from "events";
import parseTorrent from "parse-torrent";

const watchedFileTypes = new Set(["torrent", "magnet"]);

const admonishment = `The watched directory should contain only regular files of these types: ${[
	...watchedFileTypes,
]}`;

/**
 * Emits "torrent" events when .torrent files are added to watchDir.
 */
export class Watcher extends EventEmitter {
	/**
	 * @param {import('./mettre').MettreConfig} config
	 */
	constructor({ settings, logger }) {
		super({ captureRejections: true });
		this.logger = logger;

		if (!settings.dir) {
			throw new Error(`torrent watcher dir must be an accessible directory`);
		}
		this.watchDir = path.resolve(settings.dir);
	}
	async #handleFileAdded(baseName, stats) {
		this.logger.trace({ stats }, "saw added: %s", baseName);
		if (stats.isDirectory()) {
			this.logger.warn(
				{ stats },
				`Found subdirectory ${baseName} in watched directory. ${admonishment}`
			);
			return;
		}
		if (!stats.isFile()) {
			this.logger.warn(
				{stats},
				`Found non-regular file ${baseName} in watched directory. ${admonishment}`
			);
			return;
		}
		const type = path.extname(baseName).slice(1);
		if (!watchedFileTypes.has(type)) {
			this.logger.warn(
				{ stats },
				`Found ${baseName} in watched directory. ${admonishment}`,
			);
		}
		const filename = path.resolve(this.watchDir, baseName);
		const readFileCallback = async (encoding) => {
			this.logger.trace(
				`"${type}" event callback called, reading file ${filename}`
			);
			const contents = await readFile(filename, encoding);
			this.logger.trace(`successfully read file ${filename}`);
			return contents;
		};
		const contents = await readFileCallback(
			type === "magnet" ? "utf-8" : undefined
		);
		const data = parseTorrent(contents);
		const cwd = this.watchDir;
		this.emit("dropped", { type, contents, cwd, data, filename, stats });
	}
	async remove(filename) {
		try {
			await trash(filename);
		} catch (e) {
			this.logger.error(`Could not delete ${filename}: ${e.message}`);
		}
	}
	async start() {
		this.fsWatcher = chokidar.watch(".", {
			cwd: this.watchDir,
			ignoreInitial: false,
			alwaysStat: true,
		});
		this.logger.trace(`subscribing to add event`);
		this.fsWatcher.on("add", (...args) => this.#handleFileAdded(...args));
	}
	async close() {
		(await this.fsWatcher) && this.fsWatcher.close();
		this.logger.info("closed");
	}
}
