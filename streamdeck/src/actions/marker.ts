import { action, type DidReceiveSettingsEvent, type KeyAction, type KeyUpEvent, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { FootageClient } from "../footage.js";
import { type KeyArt, renderKey, toDataUrl } from "../key-art.js";

export type MarkerSettings = { color?: string };

/** The app's marker colours (src/lib/beats.js MARKER_COLORS) — the settings panel lists the same. */
export const MARKERS: Record<string, { label: string; hex: string }> = {
	green: { label: "Green", hex: "#5CC45F" },
	red: { label: "Red", hex: "#E2483F" },
	purple: { label: "Purple", hex: "#B15FD0" },
	orange: { label: "Orange", hex: "#F08C2A" },
	yellow: { label: "Yellow", hex: "#F2C230" },
	white: { label: "White", hex: "#E8E8E8" },
	blue: { label: "Blue", hex: "#4B8FE8" },
	cyan: { label: "Cyan", hex: "#3FC8D8" }
};

type Entry = { action: KeyAction<MarkerSettings>; settings: MarkerSettings; lastImage?: string; flash?: number };

/** A marker of the colour you pick in the key's settings, at the playhead (Review or Edit). */
@action({ UUID: "com.bijounga.bijoufootage.marker" })
export class MarkerAction extends SingletonAction<MarkerSettings> {
	readonly #app: FootageClient;
	readonly #keys = new Map<string, Entry>();

	constructor(app: FootageClient) {
		super();
		this.#app = app;
		app.onChange(() => this.#renderAll());
	}

	override async onWillAppear(ev: WillAppearEvent<MarkerSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		const entry: Entry = { action: ev.action, settings: { ...ev.payload.settings } };
		this.#keys.set(ev.action.id, entry);
		await this.#render(entry);
	}

	override onWillDisappear(ev: WillDisappearEvent<MarkerSettings>): void {
		this.#keys.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MarkerSettings>): Promise<void> {
		const entry = this.#keys.get(ev.action.id);
		if (!entry) return;
		entry.settings = { ...ev.payload.settings };
		entry.lastImage = undefined;
		await this.#render(entry);
	}

	override async onKeyUp(ev: KeyUpEvent<MarkerSettings>): Promise<void> {
		const entry = this.#keys.get(ev.action.id);
		if (!(await this.#app.ensureRunning())) return void ev.action.showAlert();
		const r = await this.#app.request("marker", { color: colorOf(ev.payload.settings) });
		if (r.error) return void ev.action.showAlert();
		if (entry) {
			// a moment of "✓ added" on the key
			entry.flash = Date.now() + 900;
			await this.#render(entry);
			setTimeout(() => void this.#render(entry), 950);
		}
	}

	#renderAll(): void {
		for (const e of this.#keys.values()) void this.#render(e);
	}

	async #render(entry: Entry): Promise<void> {
		const image = toDataUrl(renderKey(this.#art(entry)));
		if (image === entry.lastImage) return;
		entry.lastImage = image;
		await entry.action.setImage(image);
	}

	#art(entry: Entry): KeyArt {
		const id = colorOf(entry.settings);
		const m = MARKERS[id];
		const s = this.#app.connected ? this.#app.state : null;
		if (entry.flash && Date.now() < entry.flash) return { color: m.hex, fraction: 1, label: "MARKER", check: true, big: "", caption: "added" };
		return { color: m.hex, fraction: null, label: "MARKER", glyph: "shield", big: "", caption: m.label, dim: !s || !s.canMarker };
	}
}

const colorOf = (s: MarkerSettings) => (s.color && MARKERS[s.color] ? s.color : "yellow");
