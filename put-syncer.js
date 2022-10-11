import parseTorrent from "parse-torrent";
import PutIOAPI from "@putdotio/api-client";
import got from "got";
import FormData from "form-data";
import path, { parse } from "node:path";
import { tattle } from "./tattletale.js";

export class PutSyncer {
	constructor({
		clientToken,
		clientId,
		uploadUrl
	}, logger) {
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
		this.client = new tattle(PutIOAPI.default, this.logger)({ clientId });
		this.client.setToken(clientToken);
		this.uploadUrl = new URL(uploadUrl).href;
	}

	async #setupState() {
		this.currentState = {};
		this.logger.trace('getting account info');
		this.currentState.info = await this.client.Account.Info();
		const {
			data: {
				info
			},
		} = await this.client.Account.Info();
		this.currentState.info = info;
		const disk = this.currentState.info.disk;

		this.logger.info("Put.IO storage", {
			Available: formatBytes(disk.avail, 1),
			Used: formatBytes(disk.used, 1),
			Total: formatBytes(disk.size)
		});

		const {
			data: { status, transfers },
		} = await this.client.Transfers.Query();
		this.currentState.transfers = transfers;
		this.logger.info("transfers status %s", status);
		this.logger.trace(transfers);

		const {
			data: { files }
		} = await this.client.Files.Query();
		this.currentState.files = files;
	}

	async start() {
		await this.#setupState();
	}

	/**
	 * @param {import('@putdotio/api-client').Transfer} transfer
	 */
	async getDownloadStream(transfer) {
		const downloadUrl = await this.client.File.GetStorageURL(transfer.file_id);
		const inStream = got.stream(downloadUrl.data);
		return inStream;
	}

	async getTransfers() {
		return this.client.Transfers.Query();
	}

	async getFiles() {
		return this.client.Files.Query();
	}

	async startMagnetTransfer(magnetLink) {
		const magnetData = parseTorrent(magnetLink);
		this.trace('Read magnet data', magnetData);
		const transfer = await this.client.Transfers.Add({
			url: magnetLink,
		});
		console.log("magnet transfer started!", transfer.data);
		return transfer.data;
	}

	async startTorrentTransfer(filename, knownLength, fileData) {
		const torrentData = parseTorrent(fileData);
		this.trace('Read torrent data', torrentData);
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
