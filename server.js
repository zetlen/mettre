import { mettre } from "./lib/mettre.js";
import { envProxy } from "./env-proxy.js";

mettre(envProxy('mettre', process.env))
	.then((instance) =>
		instance.start().catch((e) => {
			console.error(e);
			return instance.close();
		})
	)
	.catch((e) => console.error(e));
