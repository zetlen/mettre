import { mettre } from "./lib/mettre.js";

mettre(process.env)
	.then((instance) =>
		instance.start().catch((e) => {
			console.error(e);
			return instance.close();
		})
	)
	.catch((e) => console.error(e));
