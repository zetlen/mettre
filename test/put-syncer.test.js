import path from "path";
import tap from "tap";
import nock from "nock";
import { PutSyncer } from "../lib/put-syncer.js";
import { envProxy } from "../lib/env-proxy.js";
import { mockConfig } from "./helpers/mock-config.js";
import { makeAllDrops } from "./helpers/make-drop.js";

const fakeConfig = {
	clientId: 5898,
	clientToken: '6FPX452FTEEMVAS46BJJ',
	clientSecret: 'N36WMKEGLQOLW6Y6T62K',
	pageSize: 2,
	uploadUrl: 'https://upload.put.io/v2/files/upload'
}

const baseDir = path.dirname(new URL(import.meta.url).pathname);
const fixtureDir = path.join(baseDir, "fixtures");

tap.test("PutSyncer validates arguments", (t) => {
	t.throws(
		() => new PutSyncer(mockConfig({ clientToken: 123 })),
		{ message: "OAUTH env vars missing" },
		"validates oauth vars"
	);
	t.end();
});

tap.test("PutSyncer contacts put.io", async (t) => {
	t.plan(6);
	const drops = await makeAllDrops();
	// const config = mockConfig(envProxy("mettre").putSyncer);
	const config = mockConfig(fakeConfig);

	nock.back.setMode("record");
	nock.back.fixtures = fixtureDir;
	const { nockDone } = await nock.back("putio-responses.json");
	const syncer = new PutSyncer(config);
	await t.resolves(syncer.start(), "start()");

	t.matchSnapshot(syncer.currentState, "state after start");

	syncer.on("downloadable", ({ dest, url, file }) => {
		t.matchSnapshot({ dest, url, file }, `downloadable ${dest} from ${url}`);
	});

	await syncer.finalize({
		hash: "d64bae4b1b1868df39c305c42b867142911bdaa2",
		name: "American.Gigolo.S01E07.PROPER.1080p.WEB.H264-GLHF[TGx]",
		file_id: 79799977,
	});

	await t.resolves(() => syncer.submit(drops.worms));
	await t.resolves(() => syncer.submit(drops.bitlove));
	await t.resolves(() => syncer.submit(drops.leaves));

	await t.resolves(
		syncer.cleanup({
			filePath:
				"American.Gigolo.S01E07.PROPER.1080p.WEB.H264-GLHF[TGx]/american.gigolo.s01e07.proper.1080p.web.h264-glhf.mkv",
		})
	);
	await nockDone();
});
