import { connect as ngrokConnect } from "ngrok";
import camelspace from "camelspace";
import { WebhookServer } from "./webhook-server.js";
import { BlackHoleWatcher } from "./blackhole-watcher.js";
import { PutSyncer } from "./put-syncer.js";
import { config } from "dotenv";

async function startNgrokServer() {
	config();
	const { webhook, blackhole, ngrok, putio } = camelspace.of([
		"webhook",
		"blackhole",
		"ngrok",
		"putio",
	]);

	const putSyncer = new PutSyncer(putio);

	const webhookServer = new WebhookServer(webhook);
	webhookServer.on("callback", (info) => {
		console.log("callback url called with", info);
		putSyncer.download(info);
	});

	const blackholeObserver = new BlackHoleWatcher(blackhole);
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
	console.log("webhook running at %s", callbackEndpoint);
	const putCallbackUrl = await putSyncer.getCallbackUrl();
	console.log("put.io will call back %s", putCallbackUrl);
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
