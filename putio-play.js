import camelspace from "camelspace";
import pino from "pino";
import { PutSyncer } from "./put-syncer.js";
export async function getTestSyncer() {
	const { putio } = camelspace.of([
		"putio",
	]);
	const logger = pino({
		transport: {
			target: 'pino-pretty'
		},
		level: 'trace'
	})
	const putSyncer = new PutSyncer(putio, logger);
	await putSyncer.start();
	return putSyncer;
}
