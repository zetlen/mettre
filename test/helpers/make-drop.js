import path from "node:path";
import fs from "node:fs/promises";
import parseTorrent from "parse-torrent";

const baseDir = path.dirname(new URL(import.meta.url).pathname);
const fixtureDir = path.join(baseDir, "../fixtures");

/** @returns {import('../../lib/watcher').FoundTorrent} */
export async function makeDrop(filename) {
	const filePath = path.join(fixtureDir, filename);
	const type = path.extname(filename).slice(1);
	const stats = await fs.stat(filePath);
	const contents = await fs.readFile(
		filePath,
		type === "magnet" ? "utf-8" : undefined
	);
	const data = parseTorrent(contents);
	return {
		type,
		contents,
		cwd: fixtureDir,
		data,
		filename,
		stats,
	};
}

export async function makeAllDrops() {
	const drops = {};
	const allFixtures = await fs.readdir(fixtureDir);
	for (const fixture of allFixtures) {
		const extname = path.extname(fixture);
		if (extname === ".magnet" || extname === ".torrent") {
			drops[path.basename(fixture, extname)] = await makeDrop(fixture);
		}
	}
	return drops;
}
