function isPrimitive(value) {
	if (!value) {
		return true;
	}
	const theType = typeof value;
	return theType === "string" || theType === "number" || theType === "boolean";
}
function isThenable(obj) {
	return (
		!!obj &&
		(typeof obj === "object" || typeof obj === "function") &&
		typeof obj.then === "function"
	);
}

const LOG_INVOCATIONS_PROXY = Symbol.for("LOG_INVOCATIONS_PROXY");
const isLogProxy = (obj) => Reflect.has(obj, LOG_INVOCATIONS_PROXY);

export function logInvocations(obj, name, depth, callback) {
	function proxyFunction(func, path) {
		let callIds = 0;
		const dotPath = path.join(".");
		const logPrefix = `INVOCATION:${dotPath}:`;
		function cbInvoke(callId, args) {
			callback({
				msg: `${logPrefix}${callId} called with ${args.length} args`,
				args,
				path,
				callId,
			});
		}
		function cbReturn(callId, returned) {
			callback({
				message: `${logPrefix}${callId} returned a ${typeof returned}`,
				returned,
				path,
				callId,
			});
		}
		function cbThrow(callId, e) {
			callback({
				message: `${logPrefix}${callId} threw ${e.message}`,
				path,
				callId,
			});
			throw e;
		}
		return new Proxy(func, {
			apply(target, thisArg, args) {
				callIds += 1;
				const callId = callIds;
				cbInvoke(callId, args);
				try {
					const returnValue = target.apply(thisArg, args);

					if (isThenable(returnValue)) {
						returnValue.then(
							(out) => {
								cbReturn(callId, out);
								return out;
							},
							(e) => {
								cbThrow(callId, e);
								return Promise.reject(e);
							}
						);
					} else {
						cbReturn(callId, returnValue);
					}
					return returnValue;
				} catch (e) {
					cbThrow(callId, e);
					throw e;
				}
			},
		});
	}
	function proxyObject(obj, path) {
		return new Proxy(obj, {
			get(target, prop) {
				const value = target[prop];
				if (
					!Reflect.has(target, prop) ||
					isPrimitive(value) ||
					path.length >= depth ||
					isLogProxy(value)
				) {
					return value;
				}
				const newPath = path.concat(prop.toString());
				const newProxy = proxyValue(value, newPath);
				Reflect.set(target, prop, newProxy);
				return newProxy;
			},
		});
	}
	function proxyValue(value, path) {
		const proxy =
			typeof value === "function"
				? proxyFunction(value, path)
				: proxyObject(value, path);
		Reflect.set(proxy, LOG_INVOCATIONS_PROXY, true);
		return proxy;
	}
	return proxyValue(obj, [name]);
}

export function tattle(
	logger = console,
	instance,
	name = "tattled",
	depth = 3
) {
	return logInvocations(instance, name, depth, (invocation) =>
		logger.trace(invocation)
	);
}
