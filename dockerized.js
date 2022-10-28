import { mettre } from "./lib/mettre.js";
import { envProxy } from "./env-proxy.js";

const dockerEnv = {
	METTRE_DOWNLOADER_DIRS_INCOMPLETE: '/downloads/incomplete',
	METTRE_DOWNLOADER_DIRS_COMPLETE: '/downloads/complete',
	METTRE_WATCHER_DIR: '/drop',
	METTRE_WEBHOOKS_HOST: '0.0.0.0',
	METTRE_WEBHOOKS_PORT: 8121,
	...process.env,
}

mettre(envProxy('mettre', dockerEnv))
	.then((instance) =>
		instance.start().catch((e) => {
			console.error(e);
			return instance.close();
		})
	)
	.catch((e) => console.error(e));
