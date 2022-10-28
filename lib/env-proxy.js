import changeCase from "change-case";
function autoProxy(entries) {
	function camelGet(target, prop) {
		if (Reflect.has(target, prop) || typeof prop === "symbol") {
			return target[prop];
		}
		const propConstantCase = changeCase.constantCase(prop);
		const propPrefix = propConstantCase + "_";
		const subEntries = [];
		for (const [name, value] of entries) {
			if (name === propConstantCase) {
				target[name] = value;
				return value;
			}
			if (name.startsWith(propPrefix)) {
				subEntries.push([name.slice(propPrefix.length), value]);
			}
		}
		if (subEntries.length > 0) {
			return autoProxy(subEntries);
		} else {
			const error = new Error(`Missing environment variable! "${propConstantCase}" does not exist, nor do any vars beginning with "${propPrefix}".`)
			Error.captureStackTrace(target);
			throw error;
		}
	}
	const cache = Object.create(null);
	for (const [name, value] of entries) {
		cache[changeCase.camelCase(name)] = value;
	}
	return new Proxy(cache, {
		get: camelGet,
		has: (target, prop) => camelGet(target, prop) !== undefined,
		ownKeys(target) {
			return [...new Set([...Object.keys(target)])];
		},
		getOwnPropertyDescriptor: (target, prop) => ({
			enumerable: true,
			configurable: true,
			value: camelGet(target, prop),
		}),
	});
}

export function envProxy(namespace, env = process.env) {
	return autoProxy(Object.entries(env))[namespace];
}
