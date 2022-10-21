import PutIOAPI from "@putdotio/api-client";
import FormData from "form-data";
import path from "node:path";
import { EventEmitter } from "events";
import debounce from "debounce-promise";

export class PutSyncer extends EventEmitter {
	/**
	 * @param {import('./mettre').MettreConfig} config
	 */
	constructor({ settings, logger }) {
		super({ captureRejections: true });
		this.logger = logger.child(
			{},
			{ redact: ["request", "headers", "body", "config"] }
		);

		const { clientId, clientToken, uploadUrl } = settings;
		if (!clientToken || !clientId) {
			throw new Error(`OAUTH env vars missing`);
		}
		/** @type {import("@putdotio/api-client").default} */
		this.client = new PutIOAPI.default({ clientId });
		this.client.setToken(clientToken);
		this.uploadUrl = new URL(uploadUrl).href;

		this.updateFiles = debounce(this.updateFiles, 1000, { leading: true });
		this.updateTransfers = debounce(this.updateTransfers, 1000, {
			leading: true,
		});
	}

	async updateInfo() {
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

	async updateTransfers() {
		const perPage = 500;
		const list = [];
		const byStatus = {};
		const byHash = {};
		async function intake(response) {
			const {
				data: { transfers, cursor },
			} = await response;
			for (const transfer of transfers) {
				list.push(transfer);
				byHash[transfer.hash] = transfer;
				const status = transfer.status.toLowerCase();
				byStatus[status] = byStatus[status] || [];
				byStatus[status].push(transfer);
			}
			if (cursor) {
				await intake(this.client.Transfers.Continue(cursor, { perPage }));
			}
		}
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

	async updateFiles() {
		const perPage = 50;
		const opts = { perPage };
		const orphans = new Map();
		const byId = new Map();
		const root = {
			children: {},
		};
		async function intake(response) {
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
		}
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
		this.updating = Promise.all([
			this.updateInfo(),
			this.updateFiles(),
			this.updateTransfers(),
		]);
		await this.updating;
		setTimeout(() => {
			this.updating = undefined;
		}, 500);
	}

	async start() {
		await this.#update();
		const { completed } = this.currentState.transfers.byStatus;
		if (completed.length > 0) {
			this.logger.info(
				`${completed.length} transfers are already complete. Notifying..`
			);
			for (const transfer of completed) {
				this.#emitTransferDownloads(transfer);
			}
		}
	}

	async cleanup({ filePath }) {
		await this.updateFiles();
		const file = this.#getFileByPath(filePath);
		this.logger.info(
			`Informed that ${filePath} has finished downloading. Deleting from put.io`
		);
		try {
			await this.client.Files.Delete([file.id]);
		} catch (e) {
			this.logger.error(e, `Unable to delete ${filePath}`);
			return;
		}
		try {
			this.logger.trace(`Checking if parent folder is now empty`);
			const {
				data: { files, parent },
			} = await this.client.Files.Query(file.parent_id);
			if (files.length === 0) {
				this.logger.info(
					`${filePath} parent folder ${parent.name} is now empty. Deleting from put.io`
				);
			}
			await this.client.Files.Delete([parent.id]);
		} catch (e) {
			this.logger.warn(
				e,
				`Failed to check if parent directory of ${filePath} was empty and delete if so`
			);
		}
	}

	/**
	 * @param {import('@putdotio/api-client').Transfer} transfer
	 */
	async finalize(transfer, isRetry = false) {
		await this.updateTransfers();
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
		this.#emitTransferDownloads(transfer);
	}

	getCallbackUrl() {
		return this.currentState.settings.callback_url;
	}

	#emitTransferDownloads(transfer) {
		const rootFile = this.#getFileById(transfer.file_id);
		this.#emitDownloadable(rootFile);
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
			throw new Error(`File not found: ${filePath}`);
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
					this.emit(
						"downloadable",
						{
							dest: filePath,
							url: res.data.url,
							file,
						},
						(downloaded) => {
							if (downloaded) {
								this.logger.info(
									`Received word that ${filePath} was downloaded. Deleting...`
								);
								this.client.Files.Delete(file.id)
									.then(() => {
										this.logger.info(`Deleted ${filePath} from put.io`);
									})
									.catch((e) => {
										this.logger.error(
											`Unable to delete ${filePath} on putio:`,
											e
										);
									});
							} else {
								this.logger.warn(
									`Received word that ${filePath} could not be downloaded. Not deleting.`
								);
							}
						}
					);
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
		const existing = this.currentState.transfers.byHash[torrentData.infoHash];
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
		await this.updateTransfers();
		if (this.#transferAlreadyExists(dropped)) {
			return;
		}
		const submitting =
			dropped.type === "magnet"
				? this.startMagnetTransfer(dropped)
				: this.startTorrentTransfer(dropped);
		const transfer = await submitting;
		this.emit("submitted", dropped, transfer.data);
	}

	async startMagnetTransfer(magnet) {
		const { contents } = magnet;
		const transfer = await this.client.Transfers.Add({
			url: contents,
		});
		this.logger.info({ transfer }, "magnet transfer started!");
		return transfer;
	}

	async startTorrentTransfer(torrent) {
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
	async removeFiles({ download, torrent }) {
		this.logger.warn({ download, torrent }, "unimplemented: removeFiles");
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
