import fastify from "fastify";
import sensible from "@fastify/sensible";
import formBody from "@fastify/formbody";
import noIcon from "fastify-no-icon";
import { EventEmitter } from "node:events";

const envToLogger = {
  development: {
		redact: ['returned.config', 'returned.headers', 'returned.request'],
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
  production: true,
  test: false,
}

export class WebhookServer extends EventEmitter {
	constructor({ host, port, callPath = "/done", logger }) {
		super();
		this.port = Number(port);
		this.host = host;
		this.callPath = callPath;
		const app = fastify({ logger: {
			...envToLogger[process.env.NODE_ENV || "production"],
			...logger
		} });
		this.logger = app.log;
		app.register(sensible);
		app.register(noIcon);
		app.register(formBody);

		app.post(callPath, async (req, reply) => {
			reply.code(204);
			this.emit("callback", req.body);
		});

		this.app = app;
	}
	async start() {
		return new Promise((resolve, reject) => {
			this.app.listen(
				{ port: this.port, host: this.host },
				async (e, address) => {
					if (e) {
						return reject(e);
					}
					resolve(new URL(this.callPath, address).href);
				}
			);
		});
	}
}
