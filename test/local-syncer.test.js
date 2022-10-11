import path from "path";
import os from "os";
import fs from "node:fs";
import test from "tape";
import { LocalSyncer } from "../local-syncer.js";

test("local syncer", function testWatcher(t) {
	t.plan(2);
	const watchDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "mettre-watcher-test")
	);
	t.comment(`temp watchDir ${watchDir}`);
	const torrentFile = path.join(watchDir, "test1.torrent");
	const magnetFile = path.join(watchDir, "test2.magnet");
	const syncer = new LocalSyncer({ watchDir, pollInterval: 200 });
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
		fs.rmSync(watchDir, { force: true, recursive: true });
		syncer.close().catch((e) => t.fail(e));
	});
});
