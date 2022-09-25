import assert from "node:assert";
import { arrayDiff } from "../array-diff.js";

assert.deepStrictEqual(arrayDiff(['ernie','bert','bigbird'],['bert','ernie','bigbird','snuffy']),{
	removed: [],
	added: ['snuffy']
});

assert.deepStrictEqual(arrayDiff(['ernie','bert'],['bert','ernie']), {
	removed: [],
	added: []
});

assert.deepStrictEqual(arrayDiff(['ernie','bert','elmo'],['bert','ernie']), {
	removed: ['elmo'],
	added: []
});

assert.deepStrictEqual(arrayDiff(['ernie','bert','elmo','snuffy','grover'],['bert','ernie','telly','oscar']), {
	removed: ['elmo','snuffy','grover'],
	added: ['telly','oscar']
});
