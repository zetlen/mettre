import pino from "pino";

/** @type {import('pino').LoggerOptions} */
const baseLogger = {
	redact: ["returned.config", "returned.headers", "returned.request"],
};

const envToLogger = {
	/** @type {import('pino').LoggerOptions} */
	development: {
		...baseLogger,
		transport: {
			target: "pino-pretty",
			options: {
				translateTime: "HH:MM:ss Z",
				ignore: "pid,hostname",
			},
		},
	},
	production: baseLogger,
	/** @type {import('pino').LoggerOptions} */
	test: {
		level: "silent",
	},
};

export function makeLogger(loggerConfig, env) {
	const defaults = envToLogger[env] || baseLogger;
	return pino({ ...defaults, ...loggerConfig });
}
