import PutIOAPI from "@putdotio/api-client";
import FormData from "form-data";
import path from "node:path";
import { EventEmitter } from "events";
import debounce from "debounce-promise";
import { tattle } from "../tattletale.js";

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

	async #updateTransfers() {
		const perPage = this.pageSize;
		const list = [];
		const byHash = new Map();
		const byStatus = {};
		const intake = async (response) => {
			const {
				data: { transfers, cursor },
			} = await response;
			for (const transfer of transfers) {
				list.push(transfer);
				byHash.set(transfer.hash, transfer);
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
		this.currentState.transfers = { list, byHash, byStatus };
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
		/** @type {Array<import('@putdotio/api-client').Transfer} */
		const transfers = this.currentState.transfers.list;
			for (const transfer of transfers) {
				this.logger.trace({ transfer }, '%s transfer %s found %s% complete on startup!', transfer.status, transfer.name, transfer.completion_percent)
				if (transfer.completion_percent === 100) {
					this.#emitTransferDownloads(transfer);
				}
			}
	}

	async cleanup({ filePath }) {
		await this.#updateFiles();
		this.logger.warn('cleanup("%s"): skipping for now!', filePath);
		this.logger.info(
			`Informed that ${filePath} has finished downloading. Deleting from put.io`
		);
		let file;
		try {
			file = this.#getFileByPath(filePath);
			if (file.file_type !== "FOLDER") {
				await this.client.Files.Delete([file.id]);
			} else {
				this.logger.warn({ file }, "file found at %s was a folder", filePath);
			}
		} catch (e) {
			this.logger.error(e, "Unable to delete %s", filePath);
			return;
		}
		try {
			this.logger.trace(`Checking if parent folder is now empty`);
			const {
				data: { files, parent },
			} = await this.client.Files.Query(file.parent_id);
			if (files.length === 0) {
				if (!parent.parent_id) {
					this.logger.warn(
						{ parent },
						"Found what appears to be root folder, not deleting"
					);
				}
				this.logger.info(
					`%s parent folder %s is now empty. Deleting from put.io`,
					file.name,
					parent.name
				);
			}
			await this.client.Files.Delete([parent.id]);
		} catch (e) {
			this.logger.warn(
				e,
				`Failed to check if parent directory of %s was empty and delete if so`,
				filePath
			);
		}
	}

	/**
	 * @param {import('@putdotio/api-client').Transfer} transfer
	 */
	async finalize(transfer, isRetry = false) {
		this.logger.trace({ transfer, isRetry }, "finalize() called with transfer");
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
			setTimeout(() => this.finalize(transfer, true), 2000);
			return;
		}
		await this.#updateFiles();
		this.#emitTransferDownloads(transfer);
		try {
			await this.client.post("/transfers/clean", {
				data: {
					transfer_ids: transfer.id,
				},
			});
		} catch (err) {
			this.logger.error(
				{ err },
				`could not clean transfer with no files ${e.message}`
			);
		}
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

		const transfer = await this.client.post(this.uploadUrl, {
			data: form,
			headers: {
				...form.getHeaders(),
				"content-length": form.getLengthSync(),
				Authorization: `Bearer ${this.client.token}`,
			},
		});

		this.logger.info({ transfer }, "torrent transfer started!");
		return transfer;
	}
	close() {
		this.logger.info("closed");
	}
}

function formatBytes(bytes, decimals = 2) {
	if (!+bytes) return "0 Bytes";

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
