import { action, type KeyAction, type KeyUpEvent, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { FootageClient } from "../footage.js";
import { type KeyArt, renderKey, toDataUrl } from "../key-art.js";

/** The record key has nothing to set. */
type RecordSettings = { unused?: string };

const RED = "#FF4A58";
const AMBER = "#F5C542";
const IDLE = "#8A93A6";

type Entry = { action: KeyAction<RecordSettings>; lastImage?: string };

/**
 * Record voiceover: in Edit it records straight over the cut, in the Voiceover tab a new take.
 * The key shows the count-in, then REC and how long you've been talking; tap again to stop.
 */
@action({ UUID: "com.bijounga.bijoufootage.record" })
export class RecordAction extends SingletonAction<RecordSettings> {
	readonly #app: FootageClient;
	readonly #keys = new Map<string, Entry>();
	#blink = false;

	constructor(app: FootageClient) {
		super();
		this.#app = app;
		app.onChange(() => this.#renderAll());
		// the REC dot blinks while recording
		setInterval(() => {
			if (this.#app.state?.rec?.phase !== "recording") return;
			this.#blink = !this.#blink;
			this.#renderAll();
		}, 600);
	}

	override async onWillAppear(ev: WillAppearEvent<RecordSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		const entry: Entry = { action: ev.action };
		this.#keys.set(ev.action.id, entry);
		await this.#render(entry);
	}

	override onWillDisappear(ev: WillDisappearEvent<RecordSettings>): void {
		this.#keys.delete(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<RecordSettings>): Promise<void> {
		if (!(await this.#app.ensureRunning())) return void ev.action.showAlert();
		const r = await this.#app.request("record");
		if (r.error) await ev.action.showAlert();
	}

	#renderAll(): void {
		for (const e of this.#keys.values()) void this.#render(e);
	}

	async #render(entry: Entry): Promise<void> {
		const image = toDataUrl(renderKey(this.#art()));
		if (image === entry.lastImage) return;
		entry.lastImage = image;
		await entry.action.setImage(image);
	}

	#art(): KeyArt {
		const s = this.#app.connected ? this.#app.state : null;
		if (!s) return { color: IDLE, fraction: null, label: "VOICEOVER", glyph: "rec", big: "", caption: "not open", dim: true };
		const rec = s.rec;
		const where = rec?.where === "voiceover" || (!rec && s.workspace === "voiceover") ? "Voiceover" : "over the cut";
		if (rec && rec.phase === "recording") {
			return { color: RED, fraction: this.#blink ? 1 : 0.0001, label: "● REC", labelColor: RED, big: clock(rec.seconds), caption: where };
		}
		if (rec && rec.phase === "countdown") {
			return { color: AMBER, fraction: null, label: "GET READY", labelColor: AMBER, big: rec.countdown > 0 ? (rec.where === "edit" ? rec.countdown.toFixed(1) : String(Math.ceil(rec.countdown))) : "…", caption: where };
		}
		if (rec && rec.phase === "saving") return { color: RED, fraction: null, label: "SAVING", big: "…", caption: where };
		if (!s.canRecord) return { color: IDLE, fraction: null, label: "RECORD", glyph: "rec", big: "", caption: "Edit or VO", dim: true };
		return { color: RED, fraction: null, label: "RECORD", glyph: "rec", big: "", caption: where };
	}
}

function clock(seconds: number): string {
	const s = Math.floor(seconds);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
