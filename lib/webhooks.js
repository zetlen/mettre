import fastify from "fastify";
import { connect as ngrokConnect } from "ngrok";
import formBody from "@fastify/formbody";
import { EventEmitter } from "node:events";

export class Webhooks extends EventEmitter {
	/**
	 * @param {import('./mettre').MettreConfig} config
	 */
	constructor({ settings: { port, baseUrl, host, ngrok }, logger }) {
		super();
		this.ngrok = ngrok;
		this.port = Number(port);
		this.host = host;
		this.baseUrl = baseUrl;
		this.logger = logger;

		this.logger.info({
			port,
			baseUrl,
			host,
			msg: `Will bind to ${host}:${port}/${baseUrl}`,
		});

		const app = fastify({ logger });
		this.app = app;
		app.register(formBody);

		app.post(`${this.baseUrl}/:event`, async (req, reply) => {
			this.logger.trace({
				msg: "Webhook called!",
				body: req.body,
				hook: `${this.baseUrl}/${req.params.event}`,
				referer: req.headers.referer,
			});
			this.emit(req.params.event, req.body, req);
			reply.code(204);
		});
	}
	async start() {
		await this.app.listen({ port: this.port, host: this.host });
		const ngrokUrl = await ngrokConnect({
			...this.ngrok,
			port: this.port,
		});
		const callbackEndpoint = new URL(this.baseUrl, ngrokUrl).href;
		this.logger.info("webhook running at %s", callbackEndpoint);
		return callbackEndpoint;
	}
	async close() {
		return this.app.close();
	}
}
