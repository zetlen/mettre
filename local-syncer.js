import path from "path";
import chokidar from "chokidar";
import {
	readdir,
	readFile,
	rename as move,
	unlink as trash,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { EventEmitter } from "events";

const anyTheSame = (args) => new Set(args).size !== args.length;

const watchedFileTypes = new Set(["torrent", "magnet"]);

const admonishment = `The watched directory should contain only regular files of these types: ${[
	...watchedFileTypes,
]}`;

/**
 * Emits "torrent" events when .torrent files are added to watchDir.
 *
 * @param {Object} options Initializer options
 * @param {string} options.watchDir Directory to watch for added torrents
 * @param {string} options.interval Millisecond interval of directory polling
 * @returns EventEmitter
 */
export class LocalSyncer extends EventEmitter {
	constructor(
		{ watchDir, incompleteDir, completeDir, deleteOriginal },
		logger
	) {
		super({ captureRejections: true });
		this.logger = logger;

		if (!(watchDir && incompleteDir && completeDir)) {
			throw new Error(
				`LOCAL_COMPLETE_DIR, LOCAL_INCOMPLETE_DIR and LOCAL_WATCH_DIR must all be populated`
			);
		}
		this.watchDir = path.resolve(watchDir);
		this.incompleteDir = path.resolve(incompleteDir);
		this.completeDir = path.resolve(completeDir);
		this.deleteOriginal = deleteOriginal;

		if (anyTheSame([this.watchDir, this.incompleteDir, this.completeDir])) {
			throw new Error(
				`LOCAL_COMPLETE_DIR=${this.completeDir}, LOCAL_INCOMPLETE_DIR=${this.incompleteDir}, and LOCAL_WATCH_DIR=${this.watchDir} must all be different locations!`
			);
		}
	}
	async #handleFileAdded(baseName, stats) {
		this.logger.trace("saw added:", baseName, stats);
		if (!stats.isDirectory()) {
			this.logger.warn(
				`Found subdirectory ${baseName} in watched directory. ${admonishment}`,
				stats
			);
			return;
		}
		if (!stats.isFile()) {
			this.logger.warn(
				`Found non-regular file ${baseName} in watched directory. ${admonishment}`,
				stats
			);
			return;
		}
		const extname = path.extname(baseName).slice(1);
		if (!watchedFileTypes.has(extname)) {
			this.logger.info(
				`Found ${baseName} in watched directory. ${admonishment}`,
				stats
			);
		}
		const filename = path.resolve(this.watchDir, baseName);
		const readFileCallback = async () => {
			this.logger.trace(
				`"${extname}" event callback called, reading file ${filename}`
			);
			const contents = await readFile(filename);
			this.logger.trace(`successfully read file ${filename}`);
			return contents;
		};
		if (extname === "magnet") {
			this.#emitMagnetEvent(baseName, await readFileCallback());
		} else {
			this.#emitTorrentEvent(baseName, stats, readFileCallback);
		}
	}
	#emitMagnetEvent(filename, link) {
		this.emit("magnet", { filename, link, cwd: this.watchDir });
	}
	#emitTorrentEvent(filename, stats, readFileCallback) {
		this.emit("torrent", { filename, stats, cwd: this.watchDir }, readFileCallback);
	}
	async start() {
		this.logger.trace(`starting file watcher for ${this.watchDir}`);
		this.fsWatcher = chokidar.watch(".", {
			cwd: this.watchDir,
			ignoreInitial: true,
			alwaysStat: true,
		});
		this.logger.trace(`subscribing to add event`);
		this.fsWatcher.on("add", (...args) => this.#handleFileAdded(...args));
	}
	async download(name, downloadStream) {
		const downloadingLocation = path.join(this.incompleteDir, name);
		const doneLocation = path.join(this.completeDir, name);
		this.logger.info(
			`downloading ${name} to ${downloadingLocation}; when complete, will move to ${doneLocation}`
		);
		const outStream = createWriteStream(downloadingLocation, {
			encoding: "binary",
		});
		await pipeline(downloadStream, outStream);
		this.logger.info(`download of ${name} complete! moving to ${doneLocation}`);
		await move(downloadingLocation, doneLocation);
		this.logger.info(`${name} moved to ${doneLocation}`);
		if (this.deleteOriginal) {
			const original = path.join(this.watchDir, name);
			this.logger.info(`deleting original torrent ${original}`);
			await trash(original);
		}
	}
	async close() {
		return this.fsWatcher && this.fsWatcher.close();
	}
}
