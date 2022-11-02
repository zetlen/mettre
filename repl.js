import { createMettre } from "./lib/mettre.js";
import { envProxy } from "./lib/env-proxy.js";

export function fromEnv() {
	return createMettre(envProxy("mettre"));
}

async function cres(clientCall) {
	try {
		const { data } = await clientCall;
		return data;
	} catch (e) {
		throw new Error(e.message);
	}
}

export const pick = (o, props) => {
	const out = {};
	for (const prop of props) {
		out[prop] = o[prop];
	}
	return out;
};

export { createMettre, envProxy, cres };
