import { EventEmitter } from "events";

export class Download extends EventEmitter {
	constructor(url, dest) {
		super();
		this.url = url;
		this.dest = dest;
		this.stream = got.stream(url);
	}
}
