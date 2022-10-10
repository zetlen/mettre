import { createWriteStream } from "node:fs";
import { readdir, readFile, rename as move } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import parseTorrent from "parse-torrent";
import PutIOAPI from "@putdotio/api-client";
import got from "got";
import FormData from "form-data";
import path from "node:path";
import { tattle } from "./tattletale.js";

export class PutSyncer {
	constructor({
		clientToken,
		clientId,
		incompleteDir,
		completeDir,
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
		if (!incompleteDir) {
			throw new Error(`env var missing: PUTIO_INCOMPLETE_DIR`);
		}
		if (!completeDir) {
			throw new Error(`env var missing: PUTIO_COMPLETE_DIR`);
		}
		this.incompleteDir = path.resolve(incompleteDir);
		this.completeDir = path.resolve(completeDir);
		if (this.incompleteDir === this.completeDir) {
			throw new Error(
				`PUTIO_COMPLETE_DIR and PUTIO_INCOMPLETE_DIR are both ${this.incompleteDir}, they cannot both be the same`
			);
		}

		/** @type {import("@putdotio/api-client").default} */
		this.client = new tattle(PutIOAPI.default, this.logger)({ clientId });
		this.client.setToken(clientToken);
		this.uploadUrl = new URL(uploadUrl).href;
		this.incompleteDir = path.resolve(incompleteDir);
		this.completeDir = path.resolve(completeDir);
	}

	async start() {
		await readdir(this.incompleteDir);
		await readdir(this.completeDir);
		this.currentState = {};
		this.currentState.info = await this.client.Account.Info();
		const {
			data: {
				info: { disk },
			},
		} = await this.client.Account.Info();
		console.log("Put.IO storage");
		console.log("Available:", formatBytes(disk.avail, 1));
		console.log("Used:", formatBytes(disk.used, 1));
		console.log("Total:", formatBytes(disk.size, 1));
		const {
			data: { status, transfers },
		} = await this.client.Transfers.Query();
		console.log("transfers status %s", status);
		if (transfers.length > 0) {
			console.table(transfers, [
				"id",
				"name",
				"status",
				"completion_percent",
				"down_speed",
			]);
		}
	}

	/**
	 *
	 * @param {import('@putdotio/api-client').Transfer} transfer
	 */
	async download(transfer) {
		const downloadUrl = await this.client.File.GetStorageURL(transfer.file_id);
		const downloadingLocation = path.join(this.incompleteDir, transfer.name);
		const doneLocation = path.join(this.completeDir, transfer.name);
		const inStream = got.stream(downloadUrl.data);
		const outStream = createWriteStream(downloadingLocation, {
			encoding: "binary",
		});
		await pipeline(inStream, outStream);
		await move(downloadingLocation, doneLocation);
	}

	async getTransfers() {
		return this.client.Transfers.Query();
	}

	async getFiles() {
		return this.client.Files.Query();
	}

	async startMagnetTransfer(magnetLinkFile) {
		const magnetLink = await readFile(magnetLinkFile, "utf-8");
		const transfer = await this.client.Transfers.Add({
			url: magnetLink,
		});
		console.log("magnet transfer started!", transfer.data);
		return transfer.data;
	}

	async startTorrentTransfer(filePath, knownLength) {
		const filename = path.basename(filePath);
		const form = new FormData();
		form.append("file", await readFile(filePath), {
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
