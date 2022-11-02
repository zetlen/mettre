import { createMettre } from "./mettre.js";
import { envProxy } from "./env-proxy.js";

const namespace = process.env.hasOwnProperty("METTRE_NAMESPACE")
	? process.env.METTRE_NAMESPACE
	: "mettre";

const mettre = createMettre(envProxy(namespace));

mettre
	.start()
	.catch((e) => {
		console.error(e);
		return mettre.close();
	})
	.catch((e) => console.error(e));
