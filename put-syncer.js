import PutIOAPI from "@putdotio/api-client";
import got from "got";
import FormData from "form-data";
import path from "node:path";
// import { tattle } from "./tattletale.js";

export class PutSyncer {
	#debounce(callback, interval) {
		let timeout;
		return (...args) => {
			clearTimeout(timeout);
			timeout = setTimeout(() => callback.apply(this, args), interval);
		};
	}
	constructor({ clientToken, clientId, uploadUrl }, logger) {
		/**
		 * @type {import('pino').Logger}
		 */
		this.logger = logger;
		if (!clientToken || !clientId) {
			throw new Error(
				`OAUTH env vars missing: ${JSON.stringify(
					{ clientId, clientToken },
					null,
					2
				)}`
			);
		}
		/** @type {import("@putdotio/api-client").default} */
		//this.client = new tattle(PutIOAPI.default, this.logger)({ clientId });
		this.client = new PutIOAPI.default({ clientId });
		this.client.setToken(clientToken);
		this.uploadUrl = new URL(uploadUrl).href;

		this.updateState = this.#debounce(this.updateState, 1000);
	}

	async updateState() {
		const [info, transfers, files] = await Promise.all([
			this.getInfo(),
			this.getAllTransfers(),
			this.getAllFiles(),
		]);

		const { disk } = info;
		this.logger.info("Put.IO storage", {
			Available: formatBytes(disk.avail, 1),
			Used: formatBytes(disk.used, 1),
			Total: formatBytes(disk.size),
		});

		const transferReport = Object.entries(transfers.byStatus).reduce(
			(report, [status, list]) => ({
				...report,
				[status]: list.length,
			}),
			{}
		);
		this.logger.info(`${transfers.list.length} transfers:`, transferReport);

		this.logger.info(`${files.size} files`);
		this.currentState = {
			info,
			transfers,
			files,
		};
	}

	async getInfo() {
		this.logger.trace("getting account info");
		const {
			data: { info },
		} = await this.client.Account.Info();
		return info;
	}

	async getAllTransfers() {
		const perPage = 500;
		const list = [];
		const byStatus = {};
		async function intake(response) {
			const {
				data: { transfers, cursor },
			} = await response;
			for (const transfer of transfers) {
				list.push(transfer);
				const status = transfer.status.toLowerCase();
				byStatus[status] = byStatus[status] || [];
				byStatus[status].push(transfer);
			}
			if (cursor) {
				await intake(this.client.Transfers.Continue(cursor, { perPage }));
			}
		}
		await intake(this.client.Transfers.Query({ perPage }));
		return { list, byStatus };
	}

	getFilePath(fileId) {
		const { files } = this.currentState;
		let file = files.get(fileId);
		let filePath = file.name;
		while ((file = files.get(file.parent_id))) {
			filePath = path.join(file.name, filePath);
		}
		return filePath;
	}

	async getAllFiles() {
		const perPage = 500;
		const opts = {
			perPage,
			streamUrl: true,
		};
		const orphans = new Map();
		const byId = new Map();
		async function intake(response) {
			const {
				data: { files, cursor },
			} = await response;
			for (const file of files) {
				file.children = [];
				byId.set(file.id, file);
				if (orphans.has(file.id)) {
					file.children.push(...orphans.get(file.id));
					orphans.delete(file.id);
				}
				const { parent_id } = file;
				if (!parent_id) {
					continue;
				}
				if (byId.has(parent_id)) {
					byId.get(parent_id).children.push(file);
					continue;
				}
				let siblings = orphans.get(parent_id);
				if (!siblings) {
					siblings = [];
					orphans.set(parent_id, siblings);
				}
				siblings.push(file);
			}
			if (cursor) {
				await intake(this.client.Files.Continue(cursor, opts));
			}
		}
		await intake(this.client.Files.Query(-1, opts));
		if (orphans.size > 0) {
			this.logger.warn(
				"Some files were orphans!",
				[...this.orphans.values()].flat()
			);
		}
		return byId;
	}

	async start() {
		await this.updateState();
	}

	/**
	 * @param {import('@putdotio/api-client').Transfer} transfer
	 */
	async getDownload(file) {
		const inStream = got.stream(downloadUrl.data);
		return inStream;
	}

	async getDownloadsFor(transfer) {
		await this.updateState();
		const files = this.getAllFilesUnder(transfer.file_id);
		const downloads = files.map(file => ({
			dest: this.getFilePath(file.id),
			stream: got.stream(file.streamUrl)
		}));

	}

	async startMagnetTransfer(magnetLink) {
		this.logger.trace("Read magnet data", magnetData);
		const transfer = await this.client.Transfers.Add({
			url: magnetLink,
		});
		console.log("magnet transfer started!", transfer.data);
		return transfer.data;
	}

	async startTorrentTransfer(filename, knownLength, fileData) {
		const form = new FormData();
		form.append("file", fileData, {
			filename,
			knownLength,
			contentType: "application/octet-stream",
		});
		// form.set("parent_id", mainFolderId + "");
		form.append("filename", filename);

		const fileResponse = await this.client.post(this.uploadUrl, {
			data: form,
			headers: {
				...form.getHeaders(),
				"content-length": form.getLengthSync(),
				Authorization: `Bearer ${this.client.token}`,
			},
		});

		const currentTransfers = await this.client.Transfers.Query();
		const theNewTransfer = await currentTransfers.body.transfers.find(
			(transfer) => {
				transfer.file_id === fileResponse.data.id;
			}
		);
		return theNewTransfer;
	}
	async getCallbackUrl() {
		const { data } = await this.client.Account.Settings();
		return data.settings.callback_url;
	}
}

// async function uploadTorrent(filePath, token) {
// const filename = path.basename(filePath);
// const form = new FormDataNode();
// form.set(
// 	"file",
// 	await fileFromPath(filePath, filename, { type: "application/octet-stream" })
// );
// form.set("parent_id", mainFolderId + "");
// form.set("filename", filename);
// const uploadResponse = await got
// 	.post(uploadUrl, { body: form, headers: {} })
// 	.json();
// const formHeaders = form.getHeaders();
// const headers = {
// 	...formHeaders,
// 	"Content-Length": form.getLengthSync(),
// 	"Content-Type": "multipart/form-data",
// 	accept: "application/json",
// 	Authorization: `Bearer ${putToken}`,
// };

// const temp = await axios({
// 	url: "https://upload.put.io/v2/files/upload",
// 	method: "POST",
// 	data: form,
// 	headers,
// });
//
// return temp.status;
// }

function formatBytes(bytes, decimals = 2) {
	if (!+bytes) return "0 Bytes";

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
