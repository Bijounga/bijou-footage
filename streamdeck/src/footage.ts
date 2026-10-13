import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

/** What the app pushes whenever a key's picture could change (see src/lib/deck.js in the app). */
export type FootageState = {
	ready: boolean;
	workspace: "review" | "edit" | "voiceover";
	canRecord: boolean;
	rec: Rec | null;
	you: { name: string; color: string; big: boolean };
	povs: { slot: number; key: string; name: string; color: string; big: boolean }[];
	canMarker: boolean;
};

export type Rec = {
	where: "edit" | "voiceover";
	phase: "countdown" | "recording" | "saving";
	seconds: number;
	countdown: number;
};

export type CatalogItem = { ws: string; id: string; label: string; wsLabel: string };
export type Catalog = {
	important: CatalogItem[];
	all: CatalogItem[];
	markerColors: { id: string; label: string; hex: string }[];
};

type Reply = Record<string, unknown> & { error?: string };

const DEFAULT_PORT = 47824;
const RECONNECT_MS = 2000;
const REQUEST_TIMEOUT_MS = 5000;
const LAUNCH_TIMEOUT_MS = 30000;

/**
 * Line-delimited JSON link to Bijou Footage's deck bridge on 127.0.0.1 (electron/main/deckBridge.js).
 * Reconnects on its own, and can start Bijou Footage (path from the deck-bridge.json it writes).
 */
export class FootageClient {
	#socket: Socket | null = null;
	#connected = false;
	#buffer = "";
	#nextId = 1;
	#pending = new Map<number, { resolve: (reply: Reply) => void; timer: NodeJS.Timeout }>();
	#listeners = new Set<() => void>();
	#reconnectTimer: NodeJS.Timeout | null = null;

	state: FootageState | null = null;

	get connected(): boolean {
		return this.#connected;
	}

	onChange(listener: () => void): void {
		this.#listeners.add(listener);
	}

	start(): void {
		this.#connect();
	}

	request(type: string, payload: Record<string, unknown> = {}): Promise<Reply> {
		if (!this.#socket || !this.#connected) return Promise.resolve({ error: "Bijou Footage isn't running" });
		const id = this.#nextId++;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				resolve({ error: "Bijou Footage didn't answer" });
			}, REQUEST_TIMEOUT_MS);
			this.#pending.set(id, { resolve, timer });
			this.#socket!.write(JSON.stringify({ ...payload, type, id }) + "\n");
		});
	}

	/** Connects, starting Bijou Footage first if it isn't running. False if it never shows up. */
	async ensureRunning(): Promise<boolean> {
		if (this.#connected) return true;
		const exePath = readBridgeInfo()?.exePath;
		if (!exePath || !existsSync(exePath)) return false;
		const bundle = exePath.match(/^(.*?\.app)\/Contents\/MacOS\//)?.[1];
		if (bundle) spawn("/usr/bin/open", [bundle], { detached: true, stdio: "ignore" }).unref();
		else spawn(exePath, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
		const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
		while (Date.now() < deadline) {
			this.#connect();
			await delay(500);
			if (this.#connected) return true;
		}
		return false;
	}

	#connect(): void {
		if (this.#socket) return;
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
		const socket = new Socket();
		this.#socket = socket;
		socket.setEncoding("utf8");
		socket.setNoDelay(true);
		socket.on("connect", async () => {
			this.#connected = true;
			this.#emit();
			const reply = await this.request("state");
			if (!reply.error && reply.ready) this.#applyState(reply);
		});
		socket.on("data", (chunk: string) => this.#receive(chunk));
		socket.on("error", () => {
			/* close follows */
		});
		socket.on("close", () => {
			const was = this.#connected;
			this.#socket = null;
			this.#connected = false;
			this.#buffer = "";
			this.state = null;
			for (const [, p] of this.#pending) {
				clearTimeout(p.timer);
				p.resolve({ error: "Bijou Footage closed" });
			}
			this.#pending.clear();
			if (was) this.#emit();
			this.#reconnectTimer = setTimeout(() => this.#connect(), RECONNECT_MS);
		});
		socket.connect(port(), "127.0.0.1");
	}

	#receive(chunk: string): void {
		this.#buffer += chunk;
		let nl: number;
		while ((nl = this.#buffer.indexOf("\n")) >= 0) {
			const line = this.#buffer.slice(0, nl).trim();
			this.#buffer = this.#buffer.slice(nl + 1);
			if (!line) continue;
			let msg: Reply;
			try {
				msg = JSON.parse(line);
			} catch {
				continue;
			}
			if (msg.type === "reply" && typeof msg.id === "number") {
				const p = this.#pending.get(msg.id);
				if (p) {
					clearTimeout(p.timer);
					this.#pending.delete(msg.id);
					p.resolve(msg);
				}
			} else if (msg.type === "state") {
				this.#applyState(msg);
			}
		}
	}

	#applyState(m: Record<string, unknown>): void {
		const you = (m.you ?? {}) as Record<string, unknown>;
		const rec = m.rec as Record<string, unknown> | null;
		this.state = {
			ready: m.ready === true,
			workspace: m.workspace === "edit" || m.workspace === "voiceover" ? m.workspace : "review",
			canRecord: m.canRecord === true,
			rec: rec
				? {
						where: rec.where === "voiceover" ? "voiceover" : "edit",
						phase: rec.phase === "recording" ? "recording" : rec.phase === "saving" ? "saving" : "countdown",
						seconds: typeof rec.seconds === "number" ? rec.seconds : 0,
						countdown: typeof rec.countdown === "number" ? rec.countdown : 0
					}
				: null,
			you: { name: typeof you.name === "string" ? you.name : "You", color: typeof you.color === "string" ? you.color : "#E5E7EB", big: you.big === true },
			povs: Array.isArray(m.povs)
				? (m.povs as Record<string, unknown>[]).map((p) => ({
						slot: Number(p.slot) || 0,
						key: String(p.key ?? ""),
						name: String(p.name ?? "POV"),
						color: typeof p.color === "string" ? p.color : "#4FD1C5",
						big: p.big === true
					}))
				: [],
			canMarker: m.canMarker === true
		};
		this.#emit();
	}

	#emit(): void {
		for (const l of this.#listeners) l();
	}
}

function dataDir(): string {
	if (process.env.BIJOU_FOOTAGE_DATA) return process.env.BIJOU_FOOTAGE_DATA;
	return join(homedir(), ".bijou-footage", "app");
}

function readBridgeInfo(): { port?: number; exePath?: string } | null {
	try {
		return JSON.parse(readFileSync(join(dataDir(), "deck-bridge.json"), "utf8"));
	} catch {
		return null;
	}
}

function port(): number {
	const fromEnv = Number(process.env.BIJOU_FOOTAGE_DECK_PORT);
	if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
	return readBridgeInfo()?.port ?? DEFAULT_PORT;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
