import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyUpEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent
} from "@elgato/streamdeck";
import type { FootageClient } from "../footage.js";
import { renderText, toDataUrl } from "../key-art.js";

export type ActionSettings = {
	ws?: string;
	id?: string;
	/** The action's name, saved with the key so it can be drawn before the app answers. */
	label?: string;
	/** What to write on the key instead (short). */
	title?: string;
};

const WS_COLOR: Record<string, string> = { review: "#33E1FF", edit: "#A78BFA", voiceover: "#FF7A85" };
const WS_LABEL: Record<string, string> = { review: "REVIEW", edit: "EDIT", voiceover: "VOICEOVER" };

type Entry = { action: KeyAction<ActionSettings>; settings: ActionSettings; lastImage?: string };

/** Any action from Bijou Footage's keybinds lists, picked in the key's settings. */
@action({ UUID: "com.bijounga.bijoufootage.action" })
export class FootageAction extends SingletonAction<ActionSettings> {
	readonly #app: FootageClient;
	readonly #keys = new Map<string, Entry>();

	constructor(app: FootageClient) {
		super();
		this.#app = app;
		app.onChange(() => this.#renderAll());
	}

	override async onWillAppear(ev: WillAppearEvent<ActionSettings>): Promise<void> {
		if (!ev.action.isKey()) return;
		const entry: Entry = { action: ev.action, settings: { ...ev.payload.settings } };
		this.#keys.set(ev.action.id, entry);
		await this.#render(entry);
	}

	override onWillDisappear(ev: WillDisappearEvent<ActionSettings>): void {
		this.#keys.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>): Promise<void> {
		const entry = this.#keys.get(ev.action.id);
		if (!entry) return;
		entry.settings = { ...ev.payload.settings };
		entry.lastImage = undefined;
		await this.#render(entry);
	}

	override async onKeyUp(ev: KeyUpEvent<ActionSettings>): Promise<void> {
		const { ws, id } = ev.payload.settings;
		if (!ws || !id) return void ev.action.showAlert();
		if (!(await this.#app.ensureRunning())) return void ev.action.showAlert();
		const r = await this.#app.request("action", { ws, action: id });
		if (r.error) await ev.action.showAlert();
	}

	// the settings panel asks for the list of actions
	override async onSendToPlugin(ev: SendToPluginEvent<{ event?: string }, ActionSettings>): Promise<void> {
		const event = ev.payload?.event;
		if (event === "launch") await this.#app.ensureRunning();
		else if (event !== "getCatalog") return;
		const reply = await this.#app.request("catalog");
		const payload = {
			event: "catalog",
			connected: this.#app.connected,
			important: reply.important ?? [],
			all: reply.all ?? []
		};
		await streamDeck.ui.sendToPropertyInspector(payload as unknown as Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0]);
	}

	#renderAll(): void {
		for (const e of this.#keys.values()) void this.#render(e);
	}

	async #render(entry: Entry): Promise<void> {
		const { ws, label, title } = entry.settings;
		const color = (ws && WS_COLOR[ws]) || "#8A93A6";
		const text = (title && title.trim()) || shorten(label) || "Pick an action";
		const image = toDataUrl(renderText({ color, label: (ws && WS_LABEL[ws]) || "ACTION", text, dim: !this.#app.connected || !ws }));
		if (image === entry.lastImage) return;
		entry.lastImage = image;
		await entry.action.setImage(image);
	}
}

/** Action names are sentences ("Cut + ripple delete everything BEFORE…"): keep what fits a key. */
function shorten(label?: string): string {
	if (!label) return "";
	return label.split(/\s+[—(·]|\s+–\s+/)[0].replace(/\s*\(.*$/, "").trim();
}
