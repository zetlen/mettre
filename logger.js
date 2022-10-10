import pino from "pino"

export class LoggerFactory {
	constructor({ level = "info", name}) {
		this.loggerConfig = {
			level, name,
			redact: ['req.headers.authorization','token','clientSecret','authTOken'],
		};
		this.baseLogger = this.#create();
	}
	#_create(opts) {
		return pino({
			...this.loggerConfig,
			...opts
		});
	}
	create(name) {
		return name ? this.baseLogger.child({ name }) : this.baseLogger;
	}
}
