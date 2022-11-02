export function formatBytes(bytes, decimals = 2) {
	if (!+bytes) return "0 Bytes";

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// /**
//  * @param {import('@putdotio/api-client').Transfer} transfer
//  */
// export function formatTransfer(transfer) {
// 	const transferSummary = `
// Transfer info:
// ${transfer.name} (ID ${transfer.id} )
// Status: ${transfer.status}
// File count: ${transfer.total_items}
// Downloaded: ${transfer.downloaded_items}
// 	`
// 	return transferSummary;
// }
