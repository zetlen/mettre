import path from "path";
import os from "os";
import fs from "node:fs";
export const scratchDir = () => {
	const dirs = [];
	const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "mettre-test-"));
	dirs.push(tempBase);
	function tempDirFac(subdir) {
		const subPath = path.join(tempBase, subdir);
		dirs.push(subPath);
		fs.mkdirSync(subPath, { recursive: true, force: true });
		return subPath;
	}
	tempDirFac.cleanup = () => {
		let dir;
		while ((dir = dirs.pop())) {
			try {
				fs.rmdirSync(dir);
			} catch (e) {
				console.warn("could not clean up", dir);
			}
		}
	};
	return tempDirFac;
};
