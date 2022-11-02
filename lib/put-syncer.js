import PutIOAPI from "@putdotio/api-client";
import FormData from "form-data";
import path from "node:path";
import { EventEmitter } from "events";
import debounce from "debounce-promise";
import { tattle } from "./tattletale.js";
import { formatBytes } from "./formatter.js";

export class PutSyncer extends EventEmitter {
	/**
	 * @param {import('./mettre').MettreConfig} config
	 */
	constructor({ settings, logger }) {
		super({ captureRejections: true });
		this.logger = logger.child(
			{},
			{
				redact: [
					"request",
					"headers",
					"body",
					"config",
					"transfer.source",
					"response",
				],
			}
		);

		const { clientId, clientToken, uploadUrl } = settings;
		if (!clientToken || !clientId) {
			throw new Error(`OAUTH env vars missing`);
		}
		/** @type {import("@putdotio/api-client").default} */
		this.client = tattle(
			logger.child({ name: "PutIOAPI" }),
			new PutIOAPI.default({ clientId }),
			"client",
			3
		);
		this.client.setToken(clientToken);
		this.uploadUrl = new URL(uploadUrl).href;

		this.updateFiles = debounce(this.#updateFiles, 1000);
		this.updateTransfers = debounce(this.#updateTransfers, 1000);

		this.pageSize = settings.pageSize || 50;
	}

	async #updateInfo() {
		this.logger.trace("getting account info");
		const [
			{
				data: { info },
			},
			{
				data: { settings },
			},
		] = await Promise.all([
			this.client.Account.Info(),
			this.client.Account.Settings(),
		]);
		const { disk } = info;
		this.logger.info(
			{
				storage: {
					Available: formatBytes(disk.avail, 1),
					Used: formatBytes(disk.used, 1),
					Total: formatBytes(disk.size),
				},
			},
			"put.io storage"
		);
		this.logger.info(`put.io callback url is ${settings.callback_url}`);
		this.currentState.info = info;
		this.currentState.settings = settings;
		return info;
	}

	async #updateOneTransfer(transfer) {
		const toUpdate = this.#getTransferByHash(transfer.hash);
		const { data } = this.client.Transfers.Get(transfer.id);
		Object.assign(toUpdate, data);
		return data;
	}

	async #updateTransfers() {
		const perPage = this.pageSize;
		const list = [];
		const byHash = new Map();
		const byFileId = new Map();
		const byStatus = {};
		const intake = async (response) => {
			const {
				data: { transfers, cursor },
			} = await response;
			for (const transfer of transfers) {
				list.push(transfer);
				byHash.set(transfer.hash, transfer);
				byFileId.set(transfer.file_id, transfer);
				const status = transfer.status.toLowerCase();
				byStatus[status] = byStatus[status] || [];
				byStatus[status].push(transfer);
			}
			if (cursor) {
				await intake(this.client.Transfers.Continue(cursor, { perPage }));
			}
		};
		await intake(this.client.Transfers.Query({ perPage }));
		const transferReport = Object.entries(byStatus).reduce(
			(report, [status, list]) => ({
				...report,
				[status]: list.length,
			}),
			{}
		);
		this.logger.info(transferReport, `${list.length} transfers`);
		this.currentState.transfers = { list, byHash, byStatus, byFileId };
	}

	async #updateFiles() {
		const perPage = 50;
		const opts = { perPage };
		const orphans = new Map();
		const byId = new Map();
		const root = {
			children: {},
		};
		const intake = async (response) => {
			const {
				data: { files, cursor },
			} = await response;
			for (const file of files) {
				file.children = {};
				byId.set(file.id, file);
				if (orphans.has(file.id)) {
					for (const orphan of orphans.get(file.id)) {
						file.children[orphan.name] = orphan;
					}
					orphans.delete(file.id);
				}
				const { parent_id } = file;
				if (!parent_id) {
					root.children[file.name] = file;
					continue;
				}
				if (byId.has(parent_id)) {
					byId.get(parent_id).children[file.name] = file;
					continue;
				}
				let orphanedSiblings = orphans.get(parent_id);
				if (!orphanedSiblings) {
					orphanedSiblings = [];
					orphans.set(parent_id, orphanedSiblings);
				}
				orphanedSiblings.push(file);
			}
			if (cursor) {
				await intake(this.client.Files.Continue(cursor, opts));
			}
		};
		await intake(this.client.Files.Query(-1, opts));
		if (orphans.size > 0) {
			this.logger.warn(
				{ orphans: [...this.orphans.values()].flat() },
				"Some files were orphans!"
			);
		}
		this.logger.info(`${byId.size} files`);
		this.currentState.files = {
			byId,
			root,
		};
	}

	async #update() {
		this.currentState = {};
		await Promise.all([
			this.#updateInfo(),
			this.#updateFiles(),
			this.#updateTransfers(),
		]);
	}

	async start() {
		await this.#update();
		for (const root of Object.values(this.currentState.files.root.children)) {
			this.#emitDownloadable(root);
		}
	}

	async release({ filePath }) {
		this.logger.info(
			`Informed that ${filePath} has finished downloading. Checking transfer status`
		);
		try {
			const file = this.#getFileByPath(filePath);
			if (!file) {
				throw new Error(`File "${filePath}" not found!`);
			}
			const transfer = this.#getTransferByFile(file);
			if (!transfer) {
				throw new Error(`Transfer not found for file "${filePath}`);
			}
			await this.#removeTransferIfDone(transfer, filePath);
		} catch (e) {
			this.logger.error(e, "Unable to delete %s", filePath);
			return;
		}
	}

	async #removeTransferIfDone(transfer, filePath) {
		await this.#updateOneTransfer(transfer);
		const remaining = transfer.size - transfer.downloaded;
		if (remaining !== 0) {
			this.logger.info(
				{ transfer, file },
				'Transfer %s for file "%s" still has %s left to download. Not deleting.',
				transfer.id,
				filePath,
				formatBytes(Number.isSafeInteger(remaining) ? remaining : transfer.size)
			);
			return;
		}
		if (transfer.status !== "COMPLETED") {
			this.logger.info(
				{ transfer },
				'Transfer %s for file "%s" is not yet completed, has status %s. Not deleting.',
				transfer.id,
				filePath,
				transfer.status
			);
		}
		this.logger.info(
			{ transfer, file },
			'With download of "%s", transfer %s is now complete. Deleting..',
			transfer.id,
			filePath
		);
		const form = new FormData();
		form.append("transfer_ids", [transfer.id]);
		await this.#postFormToClient("/transfers/remove", form);
	}

	/**
	 * @param {import('@putdotio/api-client').Transfer} transfer
	 */
	async findDownloads(transfer, isRetry = false) {
		this.logger.trace({ transfer, isRetry }, "download() called with transfer");
		await this.#updateTransfers();
		if (!this.#getTransferByHash(transfer.hash)) {
			if (isRetry) {
				console.error(
					`After checking transfer list, did not find transfer ${transfer.name} which was reported finished!`
				);
				return;
			}
			console.warn(
				`Did not find transfer ${transfer.name} completed yet after refresh. Retrying...`
			);
			setTimeout(() => this.findDownloads(transfer, true), 2000);
			return;
		}
		await this.#updateFiles();
		this.#emitTransferDownloads(transfer);
	}

	getCallbackUrl() {
		return this.currentState.settings.callback_url;
	}

	#emitTransferDownloads(transfer) {
		this.logger.trace(
			{ transfer },
			"#emitTransferDownloads() called with transfer"
		);
		const rootFile = this.#getFileById(transfer.file_id);
		if (!rootFile) {
			this.logger.error({ transfer }, "found no files for transfer.");
		} else {
			this.#emitDownloadable(rootFile);
		}
	}

	/**
	 * @returns {import('@putdotio/api-client').Transfer} transfer
	 */
	#getTransferByHash(hash) {
		return this.currentState.transfers.byHash.get(hash);
	}

	#getTransferByFile(file) {
		let transfer;
		while (!transfer && file) {
			transfer = this.currentState.transfers.byFileId.get(file.parent_id);
			file = this.#getFileById(file.parent_id);
		}
		return transfer;
	}

	/**
	 * @returns {import('@putdotio/api-client').IFile} transfer
	 */
	#getFileById(id) {
		return this.currentState.files.byId.get(id);
	}

	/**
	 * @returns {import('@putdotio/api-client').IFile} transfer
	 */
	#getFileByPath(filePath) {
		const segments = filePath.split(path.sep);
		this.logger.trace({ segments }, "finding file from segments");
		let current = this.currentState.files.root;
		while (current && segments.length > 0) {
			current = current.children[segments.shift()];
			this.logger.trace(
				{ current },
				"%d segments left: %s",
				segments.length,
				segments.join("/")
			);
		}
		if (!current) {
			throw new Error(
				`#getFileByPath("${filePath}") could not find the file in the local state file tree representation.`
			);
		}
		return current;
	}

	/**
	 * @param {import('@putdotio/api-client').IFile} file
	 */
	#emitDownloadable(file, basePath = "") {
		const filePath = path.join(basePath, file.name);
		if (file.file_type === "FOLDER") {
			Object.values(file.children).forEach((child) =>
				this.#emitDownloadable(child, filePath)
			);
		} else {
			this.client.File.GetStorageURL(file.id)
				.then((res) => {
					this.emit("downloadable", {
						dest: filePath,
						url: res.data.url,
						file,
					});
				})
				.catch((e) => {
					this.logger.error(
						`Could not get download URL for file id ${file.id} ${filePath}:`,
						e
					);
				});
		}
	}

	async #postFormToClient(url, form) {
		const { data } = await this.client.post(url, {
			data: form,
			headers: {
				...form.getHeaders(),
				"content-length": form.getLengthSync(),
				Authorization: `Bearer ${this.client.token}`,
			},
		});
		return data;
	}

	#transferAlreadyExists({ data: torrentData }) {
		/**
		 * @type {import('@putdotio/api-client').Transfer}
		 */
		const existing = this.currentState.transfers.byHash.get(
			torrentData.infoHash
		);
		if (existing) {
			this.logger.warn(
				`transfer for %s (hash %s) already exists: putio has transfer %s (hash %s) created at %s, %s% complete`,
				torrentData.name,
				torrentData.infoHash,
				existing.id,
				existing.hash,
				existing.created_at,
				existing.completion_percent
			);
			return true;
		}
		return false;
	}

	async submit(dropped) {
		await this.#updateTransfers();
		if (this.#transferAlreadyExists(dropped)) {
			return;
		}
		const submitting =
			dropped.type === "magnet"
				? this.#startMagnetTransfer(dropped)
				: this.#startTorrentTransfer(dropped);
		const transfer = await submitting;
		this.emit("submitted", dropped, transfer.data);
	}

	async #startMagnetTransfer(magnet) {
		const { contents } = magnet;
		const transfer = await this.client.Transfers.Add({
			url: contents,
		});
		this.logger.info({ transfer }, "magnet transfer started!");
		return transfer;
	}

	async #startTorrentTransfer(torrent) {
		const { contents, filename, stats } = torrent;
		const form = new FormData();
		form.append("file", contents, {
			filename,
			knownLength: stats.size,
			contentType: "application/octet-stream",
		});
		form.append("filename", filename);
		const transfer = this.#postFormToClient(this.uploadUrl, form);

		this.logger.info({ transfer }, "torrent transfer started!");
		return transfer;
	}
	close() {
		this.logger.info("closed");
	}
}
