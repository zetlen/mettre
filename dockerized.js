import { mettre } from "./lib/mettre.js";
import { envProxy } from "./lib/env-proxy.js";

mettre(envProxy())
	.then((instance) =>
		instance.start().catch((e) => {
			console.error(e);
			return instance.close();
		})
	)
	.catch((e) => console.error(e));
