import path from "path";
import chokidar from "chokidar";
import { readdir } from "fs/promises";
import { EventEmitter } from "events";

/**
 * Emits "torrent" events when .torrent files are added to watchDir.
 *
 * @param {Object} options Initializer options
 * @param {string} options.watchDir Directory to watch for added torrents
 * @param {string} options.interval Millisecond interval of directory polling
 * @returns EventEmitter
 */
export class BlackHoleWatcher extends EventEmitter {
	constructor({ watchDir, pollInterval }) {
		super({ captureRejections: true });
		this.watchDir = watchDir;
		this.pollInterval = pollInterval;
	}
	async start() {
		const { pollInterval, watchDir } = this;
		const interval = Number(pollInterval);
		if (
			Number.isNaN(interval) ||
			!Number.isSafeInteger(interval) ||
			interval < 100
		) {
			throw new Error(
				`pollInterval must be a positive integer of ms no lower than 100, but was "${pollInterval}"`
			);
		}
		const cwd = path.resolve(watchDir);
		await readdir(cwd);
		const torrentOrMagnetGlob = "*.{torrent,magnet}";
		this.fsWatcher = chokidar
			.watch(torrentOrMagnetGlob, {
				cwd,
				awaitWriteFinish: true,
				ignoreInitial: true,
				persistent: true,
				usePolling: true,
				interval: Number(interval),
				binaryInterval: Number(interval),
			})
			.on("add", async (filename, stats) => {
				console.log("BlackHoleWatcher saw added:", filename);
				const extname = path.extname(filename).slice(1);
				const size = stats.size;
				this.emit(extname, {
					filename: path.resolve(watchDir, filename),
					size,
				});
			});
	}
	async close() {
		return this.fsWatcher && this.fsWatcher.close();
	}
}

export async function observeBlackHole({ watchDir, pollInterval }) {
	emitter.close = () => emitter.fsWatcher.close();
	return emitter;
}
