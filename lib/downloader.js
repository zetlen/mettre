import path from "path";
import {
	mkdir,
	readdir,
	rename as move,
	unlink as trash,
} from "node:fs/promises";
import Aria2 from "aria2";
import { EventEmitter } from "events";

const anyTheSame = (args) => new Set(args).size !== args.length;

/**
 * Downloads files in transfer when it receives a transfer-finished event.
 *
 * @param {Object} options Initializer options
 * @param {string} options.watchDir Directory to watch for added torrents
 * @param {string} options.interval Millisecond interval of directory polling
 * @returns EventEmitter
 */
export class Downloader extends EventEmitter {
	constructor({ settings, logger }) {
		super({ captureRejections: true });
		this.logger = logger;

		const { dirs, aria2 } = settings;

		this.aria2 = new Aria2(aria2);

		function throwBadDirs(reason) {
			throw new Error(
				`Invalid directory configuration: ${JSON.stringify(
					dirs,
					null,
					1
				)}: ${reason}`
			);
		}

		if (!(dirs.incomplete && dirs.complete && dirs.aria)) {
			throwBadDirs("Incomplete and complete directories must be set");
		}
		this.incompleteDir = path.resolve(dirs.incomplete);
		this.completeDir = path.resolve(dirs.complete);
		this.aria2Dir = dirs.aria;

		if (anyTheSame([this.incompleteDir, this.completeDir])) {
			throwBadDirs("Directories cannot be the same");
		}
	}
	async #updateState() {
		this.currentState = this.currentState || {};
		const { currentState } = this;
		const multicallResult = await this.aria2.multicall([
			["tellActive"],
			["tellWaiting", 0, 100],
			["tellStopped", 0, 100],
		]);
		this.logger.trace("multicall: %j", multicallResult);
		const [[active], [waiting], [stopped]] = multicallResult;
		currentState.downloads = {
			active,
			waiting,
			stopped,
		};
		const byId = new Map();
		currentState.downloads.byId = byId;
		[...active, ...waiting, ...stopped].forEach((dl) => byId.set(dl.gid, dl));
		this.logger.info(this.currentState, "state updated, current state");
	}
	async remove(filename) {
		try {
			await trash(filename);
		} catch (e) {
			this.logger.error(`Could not delete ${filename}: ${e.message}`);
		}
	}
	async start() {
		this.starting = this.#prepare();
		await this.starting;
	}
	async #prepare() {
		try {
			await readdir(this.incompleteDir);
		} catch (e) {
			throw new Error(`Could not access incomplete directory: ${e.message}`);
		}
		try {
			await readdir(this.completeDir);
		} catch (e) {
			throw new Error(`Could not access complete directory: ${e.message}`);
		}
		await this.#updateState();
		await this.aria2.open();
		this.aria2.on("onDownloadComplete", async ([{ gid }]) => {
			try {
				const status = await this.aria2.call("tellStatus", gid);
				await this.#handleDownloadComplete(status);
			} catch (error) {
				this.logger.error(error, "Download failed!");
			}
		});
	}
	async #handleDownloadComplete(downloadInfo) {
		for (const file of downloadInfo.files) {
			const filePath = path.relative(this.aria2Dir, file.path);
			const fileSrc = path.resolve(this.incompleteDir, filePath);
			const fileDest = path.join(this.completeDir, filePath);

			this.logger.info(
				`download of ${filePath} complete! moving to ${this.completeDir}`
			);

			const destDir = path.dirname(fileDest);
			await mkdir(destDir, { recursive: true });
			this.logger.trace("made directory", destDir);

			this.logger.trace("moving %s to %s", path.basename(filePath), destDir);
			await move(fileSrc, fileDest);
			this.logger.info(`moved to ${fileDest}`);
			this.emit("complete", { download: downloadInfo, filePath });
		}
		const purgeResult = await this.aria2.call("purgeDownloadResult");
		this.logger.info("purged download:", purgeResult);
	}
	async enqueue({ dest, url }) {
		await this.starting;
		this.logger.info(`downloading ${dest}`);
		const added = await this.aria2.call("addUri", [url], {
			out: path.basename(dest),
			dir: path.join(this.aria2Dir, path.dirname(dest)),
		});
		this.logger.info(added, "added uri: %s", url);
	}
	async close() {
		return this.fsWatcher && this.fsWatcher.close();
	}
}
