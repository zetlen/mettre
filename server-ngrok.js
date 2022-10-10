import camelspace from "camelspace";
import { connect as ngrokConnect } from "ngrok";
import { WebhookServer } from "./webhook-server.js";
import { BlackHoleWatcher } from "./blackhole-watcher.js";
import { PutSyncer } from "./put-syncer.js";
import { config } from "dotenv";

async function startNgrokServer() {
	config();
	const { webhook, blackhole, ngrok, putio, log } = camelspace.of([
		"webhook",
		"blackhole",
		"ngrok",
		"putio",
		"log",
	]);


	const webhookServer = new WebhookServer(
		{...webhook, logger: log }
	);
	const logger = webhookServer.logger;

	/** @type {WebhookServer} */
	webhookServer.on("callback", async (info) => {
		await putSyncer.download(info);
	});

	const putSyncer = new PutSyncer(putio, logger.child({ name: "PutSyncer" }));
	const blackholeObserver = new BlackHoleWatcher(
		blackhole,
		logger.child({ name: "BlackHoleWatcher" })
	);
	blackholeObserver.on("torrent", ({ filename, size }) =>
		putSyncer.startTorrentTransfer(filename, size)
	);
	blackholeObserver.on("magnet", ({ filename }) =>
		putSyncer.startMagnetTransfer(filename)
	);

	await putSyncer.start();
	await webhookServer.start();
	await blackholeObserver.start();

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
