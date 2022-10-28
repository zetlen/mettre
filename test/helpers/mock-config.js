import pino from "pino";
export function mockConfig(settings) {
	return {
		settings,
		logger: pino({ level: "silent" }),
		mode: "test",
	};
}
