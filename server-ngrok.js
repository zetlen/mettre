import camelspace from "camelspace";
import { connect as ngrokConnect } from "ngrok";
import { WebhookServer } from "./webhook-server.js";
import { LocalSyncer } from "./local-syncer.js";
import { PutSyncer } from "./put-syncer.js";
import { config } from "dotenv";

async function startNgrokServer() {
	config();
	const { webhook, local, ngrok, putio, log } = camelspace.of([
		"webhook",
		"local",
		"ngrok",
		"putio",
		"log",
	]);

	/** @type {WebhookServer} */
	const webhookServer = new WebhookServer({ ...webhook, logger: log });
	const logger = webhookServer.logger;

	const putSyncer = new PutSyncer(putio, logger.child({ name: "PutSyncer" }));
	const localSyncer = new LocalSyncer(
		local,
		logger.child({ name: "LocalSyncer" })
	);

	localSyncer.on("torrent", async ({ filename, stats, data }) =>
		putSyncer.startTorrentTransfer(filename, stats.size, data)
	);
	localSyncer.on("magnet", ({ link }) => putSyncer.startMagnetTransfer(link));

	webhookServer.on("callback", async (info) => {
		const downloads = await putSyncer.getDownloadsFor(info);
		downloads.forEach((dl) => localSyncer.download(dl.dest, dl.stream));
	});

	await putSyncer.start();
	await webhookServer.start();
	await localSyncer.start();

	const ngrokUrl = await ngrokConnect({
		...ngrok,
		port: webhookServer.port,
	});
	const callbackEndpoint = new URL(webhook.callPath, ngrokUrl).href;
	logger.info("webhook running at %s", callbackEndpoint);
	const putCallbackUrl = await putSyncer.getCallbackUrl();
	logger.info("put.io will call back %s", putCallbackUrl);
	if (callbackEndpoint !== putCallbackUrl) {
		throw new Error(
			`put.io is not configured correctly: callback url is ${putCallbackUrl}. please set your callback url to ${callbackEndpoint}`
		);
	}
}

startNgrokServer().catch((e) => {
	console.error(e);
	process.exit(1);
});
