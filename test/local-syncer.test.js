import path from "path";
import os from "os";
import fs from "node:fs";
import test from "tape";
import { LocalSyncer } from "../local-syncer.js";

const scratchDir = () => {
	const dirs = [];
	const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mettre-test-'));
	dirs.push(tempBase);
	function tempDirFac(subdir) {
		const subPath = path.join(tempBase, subdir);
		dirs.push(subPath);
		fs.mkdirSync(subPath, { recursive: true, force: true });
		return subPath;
	}
	tempDirFac.cleanup = () =>  {
		let dir;
		while (dir = dirs.pop()) {
			try {
				fs.rmdirSync(dir);
			} catch (e){
				console.warn('could not clean up', dir);
			}
		}
	}
	return tempDirFac;
}


test("local syncer", function testWatcher(t) {
	t.plan(2);
	const mkTmpDir = scratchDir();
	const watchDir = mkTmpDir('blackhole')
	const completeDir = mkTmpDir('complete')
	const incompleteDir = mkTmpDir('incomplete')
	t.comment(`temp watchDir ${watchDir}`);
	const torrentFile = path.join(watchDir, "test1.torrent");
	const magnetFile = path.join(watchDir, "test2.magnet");
	const syncer = new LocalSyncer({ watchDir, completeDir, incompleteDir}, console);
	syncer.on("torrent", ({ filename }) => {
		t.equal(filename, torrentFile, ".torrent drop event fired");
	});
	syncer.on("magnet", ({ filename }) => {
		t.equal(filename, magnetFile, ".magnet drop event fired");
	});
	syncer.start().catch((e) => t.fail(e));
	setTimeout(async () => {
		try {
			const watchTorrentLoc = path.join(watchDir, "test1.torrent");
			fs.copyFileSync(
				path.resolve("./test/fixtures/test1.torrent"),
				watchTorrentLoc
			);
			t.comment(`wrote ${watchTorrentLoc}`);
			const watchMagnetLoc = path.join(watchDir, "test2.magnet");
			fs.copyFileSync(
				path.resolve("./test/fixtures/test2.magnet"),
				watchMagnetLoc
			);
			t.comment(`wrote ${watchMagnetLoc}`);
		} catch (e) {
			t.fail(e);
		}
	}, 1000);
	t.teardown(() => {
		syncer.close().catch((e) => t.fail(e));
		mkTmpDir.cleanup();
	});
});

