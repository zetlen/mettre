import path from "path";
import chokidar from "chokidar";
import fs from "fs/promises"
import picomatch from "picomatch";
import { EventEmitter } from "events";
import { arrayDiff } from "./array-diff.js"

export default async function observeBlackHole(watchDir) {
	const emitter = new EventEmitter({captureRejections: true});
	const dotTorrentGlob = '*.torrent';
	const isDotTorrentFile = picomatch(dotTorrentGlob);
	const getCurrentTorrentFiles = async () => (await fs.readdir(watchDir)).filter(t => isDotTorrentFile(t)).map(name => path.join(watchDir, name));
	let previousTorrents = await getCurrentTorrentFiles();
	emitter.watcher = chokidar.watch(dotTorrentGlob, {
		cwd: watchDir,
		awaitWriteFinish: true,
		ignoreInitial: true,
		persistent: true,
		usePolling: true,
		interval: 1000,
		binaryInterval: 1000
	}).on('all', async () => {
		const currentTorrents = await getCurrentTorrentFiles();
		const diffs = arrayDiff(previousTorrents, currentTorrents);
		if (diffs.added.length > 0 || diffs.removed.length > 0) {
			emitter.emit('change', diffs);
			previousTorrents = currentTorrents;
		}
	});
	return emitter;
}
