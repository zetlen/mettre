import camelspace from "camelspace";
import {inspect} from "util";
import fastify from "fastify"
import sensible from "@fastify/sensible";
import blipp from "fastify-blipp";
import noIcon from "fastify-no-icon";
import PutIOAPI from "@putdotio/api-client";
import { observeBlackHole } from "./watcher.js;

async function serve() {

	const { oauth } = camelspace.of(['oauth']);

	if (!oauth.clientToken || !oauth.clientId) {
		throw new Error(`OAUTH env vars missing: ${JSON.stringify(oauth, null, 2)}`)
	}

	/** @type {import("@putdotio/api-client").default} */
	const client = new PutIOAPI.default({
		clientId: oauth.clientId
	})
	client.setToken(oauth.clientToken);

		const watcher = await observeBlackHole('.');
		watcher.on('change', ({ removed, added }) => {
			if (added.length > 0) {
				// const addResponse = await client.Transfers.AddMulti([{}])
			}
		});

	const app = fastify();
	app.register(blipp);
	app.register(sensible);
	app.register(noIcon);

	app.get("/notify/:xfer", async (req, reply) => {
		if (req.params.xfer === 'abc') {
			throw app.httpErrors.imateapot()
		}
	});

	app.listen({port: 3000, host: '0.0.0.0'}, async (e, address) => {
		if (e) {
			fastify.log.error(err);
			process.exit(1);
		}
		app.blipp();
		console.log('http://hat:3000/notify/abc');
	});
}

serve().catch(e => console.error(e))
