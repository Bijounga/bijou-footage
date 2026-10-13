import { action, type DidReceiveSettingsEvent, type KeyAction, type KeyUpEvent, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { FootageClient } from "../footage.js";
import { type KeyArt, renderKey, toDataUrl } from "../key-art.js";

export type PovSettings = {
	/** 0 = your own footage, 1… = the POVs of the open recording, in their order. */
	slot?: number;
};

type Entry = { action: KeyAction<PovSettings>; settings: PovSettings; lastImage?: string };

/**
 * One view of the open recording: yours, or someone's POV. Shows their name in their colour;
 * a full ring while it's the big one. Tap to watch it big (tap the big one to go back to yours).
 */
@action({ UUID: "com.bijounga.bijoufootage.pov" })
export class PovAction extends SingletonAction<PovSettings> {
	readonly #app: FootageClient;
	readonly #keys = new Map<string, Entry>();

	constructor(app: FootageClient) {
		super();
		this.#app = app;
		app.onChange(() => this.#renderAll());
	}

	override async onWillAppear(ev: WillAppearEvent<PovSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		const entry: Entry = { action: ev.action, settings: { ...ev.payload.settings } };
		this.#keys.set(ev.action.id, entry);
		await this.#render(entry);
	}

	override onWillDisappear(ev: WillDisappearEvent<PovSettings>): void {
		this.#keys.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PovSettings>): Promise<void> {
		const entry = this.#keys.get(ev.action.id);
		if (!entry) return;
		entry.settings = { ...ev.payload.settings };
		entry.lastImage = undefined;
		await this.#render(entry);
	}

	override async onKeyUp(ev: KeyUpEvent<PovSettings>): Promise<void> {
		if (!(await this.#app.ensureRunning())) return void ev.action.showAlert();
		const r = await this.#app.request("pov", { slot: slotOf(ev.payload.settings) });
		if (r.error) await ev.action.showAlert();
	}

	#renderAll(): void {
		for (const e of this.#keys.values()) void this.#render(e);
	}

	async #render(entry: Entry): Promise<void> {
		const image = toDataUrl(renderKey(this.#art(entry.settings)));
		if (image === entry.lastImage) return;
		entry.lastImage = image;
		await entry.action.setImage(image);
	}

	#art(settings: PovSettings): KeyArt {
		const slot = slotOf(settings);
		const s = this.#app.connected ? this.#app.state : null;
		const label = slot === 0 ? "YOUR VIEW" : `POV ${slot}`;
		if (!s) return { color: "#8A93A6", fraction: null, label, big: slot === 0 ? "You" : String(slot), caption: "not open", dim: true };
		if (slot === 0) {
			const anyPov = s.povs.length > 0;
			return { color: s.you.color, fraction: s.you.big && anyPov ? 1 : null, label: s.you.big && anyPov ? "WATCHING" : label, big: short(s.you.name), caption: anyPov ? "your tracks" : "no POVs here", dim: !anyPov };
		}
		const p = s.povs.find((x) => x.slot === slot);
		if (!p) return { color: "#8A93A6", fraction: null, label, big: String(slot), caption: s.workspace === "review" ? "none yet" : "in Review", dim: true };
		return { color: p.color, fraction: p.big ? 1 : null, label: p.big ? "WATCHING" : label, big: short(p.name), caption: p.big ? "their sound" : "tap: watch" };
	}
}

const slotOf = (s: PovSettings) => (typeof s.slot === "number" && s.slot >= 0 ? s.slot : 1);

/** Names on a key: the first word if the whole name is too long ("LOAFFY Part 1" → "LOAFFY"). */
function short(name: string): string {
	if (name.length <= 7) return name;
	const first = name.split(/\s+/)[0];
	return first.length <= 8 ? first : first.slice(0, 7) + "…";
}
