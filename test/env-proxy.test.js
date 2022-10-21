import tap from "tap";
import { envProxy } from "../lib/env-proxy.js";

const ARACHNIDS = {
	ARACHNIDS_SPIDERS_TARANTULA: "Theraphosidae",
	ARACHNIDS_SPIDERS_TRAPDOOR_TREE: "Migidae",
	ARACHNIDS_SPIDERS_TRAPDOOR_BRUSHED: "Barychelidae",
	ARACHNIDS_TICKS: "ew",
	ARACHNIDS_SCORPIONS_NEW_WORLD: "Vaejovidae",
	ARACHNIDS_SCORPIONS_AFRICAN: "Hadogenes",
};

tap.test("env-proxy autocamelcases an env namespace", (t) => {
	const arachnids = envProxy("arachnids", ARACHNIDS);
	t.notOk(arachnids.octopus, "arachnids.octopus undefined");
	t.equal(arachnids.ticks, "ew", "ticks are just 'ew'");
	t.equal(arachnids.ticks, "ew", "cached");
	t.same(arachnids.spiders, {
		tarantula: "Theraphosidae",
		trapdoorTree: "Migidae",
		trapdoorBrushed: "Barychelidae",
	});
	t.same(arachnids.TICKS, arachnids.ticks);
	t.same(Object.keys(arachnids.scorpions), ["newWorld", "african"]);
	t.end();
});
