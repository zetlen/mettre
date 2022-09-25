export function arrayDiff(previous, current) {
	const prev = new Set(previous);
	const cur = new Set(current);
	const all = new Set([...previous, ...current]);
	const added = [];
	const removed = [];
	for (const item of all) {
		const prevHas = prev.has(item);
		const currHas = cur.has(item);
		if (prevHas && !currHas) {
			removed.push(item);
		}else if (currHas && !prevHas) {
			added.push(item);
		}
	}
	return { added, removed };
}
