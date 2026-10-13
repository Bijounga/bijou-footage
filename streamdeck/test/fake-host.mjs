// End-to-end test: stands in for the Stream Deck app (adapted from BijouHub's). Runs the bundled
// plugin against a running Bijou Footage (start the dev app on a throwaway data copy first),
// places keys, presses them, and records every picture the keys draw.
//   node test/fake-host.mjs   → frames in test/out/index.html
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = join(HERE, "..", "com.bijounga.bijoufootage.sdPlugin");
const OUT = join(HERE, "out");
const DEVICE = "test-device";
const SD_NODE = join(process.env.APPDATA ?? "", "Elgato", "StreamDeck", "NodeJS", "20.20.0", "node.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "  ok " : "  FAIL"}  ${msg}`); if (!ok) failures++; };

const images = new Map();
const frames = [];
let step = "start";
let plugin = null;
const alerts = [];
const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise((r) => server.once("listening", r));
const port = server.address().port;
const connected = new Promise((resolve) => {
	server.on("connection", (socket) => {
		socket.on("message", (raw) => {
			const m = JSON.parse(raw.toString());
			if (m.event === "registerPlugin") { plugin = socket; resolve(); return; }
			if (m.event === "setImage") {
				const svg = decodeURIComponent(m.payload.image.replace(/^data:image\/svg\+xml;charset=utf8,/, ""));
				images.set(m.context, svg);
				frames.push({ step, context: m.context, svg });
			}
			if (m.event === "showAlert") alerts.push({ step, context: m.context });
		});
	});
});
const info = {
	application: { font: "Segoe UI", language: "en", platform: "windows", platformVersion: "10.0.26300", version: "7.5.1.22901" },
	colors: {},
	devicePixelRatio: 2,
	devices: [{ id: DEVICE, name: "Stream Deck", size: { columns: 5, rows: 3 }, type: 0 }],
	plugin: { uuid: "com.bijounga.bijoufootage", version: "1.0.0.0" }
};
const node = existsSync(SD_NODE) ? SD_NODE : process.execPath;
const child = spawn(node, ["bin/plugin.js", "-port", String(port), "-pluginUUID", "test-plugin", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], { cwd: PLUGIN_DIR, stdio: ["ignore", "inherit", "inherit"] });
if (!(await Promise.race([connected.then(() => true), sleep(10000).then(() => false)]))) {
	console.log("FAIL  plugin never registered");
	child.kill();
	process.exit(1);
}

const keys = {};
let col = 0;
const send = (event, ctx, payload, action) => plugin.send(JSON.stringify({ action, event, context: ctx, device: DEVICE, payload }));
function appear(name, action, settings) {
	keys[name] = { ctx: "ctx-" + name, action, settings, coordinates: { column: col++, row: 0 } };
	send("willAppear", keys[name].ctx, { settings, coordinates: keys[name].coordinates, controller: "Keypad", isInMultiAction: false, state: 0 }, action);
}
function press(name) {
	const k = keys[name];
	const p = { settings: k.settings, coordinates: k.coordinates, isInMultiAction: false, state: 0 };
	send("keyDown", k.ctx, p, k.action);
	send("keyUp", k.ctx, p, k.action);
}
const img = (name) => images.get(keys[name].ctx) || "";

appear("record", "com.bijounga.bijoufootage.record", {});
appear("you", "com.bijounga.bijoufootage.pov", { slot: 0 });
appear("pov1", "com.bijounga.bijoufootage.pov", { slot: 1 });
appear("marker", "com.bijounga.bijoufootage.marker", { color: "purple" });
appear("play", "com.bijounga.bijoufootage.action", { ws: "review", id: "playPause", label: "Play / pause" });
step = "appear";
await sleep(3500); // connect + first state

check(/POV 1|WATCHING/.test(img("pov1")) && /Lofit/.test(img("pov1")), "POV 1 key shows the POV's name (" + (img("pov1").match(/>([^<]{2,})</g) || []).join(" ") + ")");
check(/MARKER/.test(img("marker")) && /#B15FD0/i.test(img("marker")), "marker key is purple");
check(/Play/.test(img("play")) && /REVIEW/.test(img("play")), "action key shows Play / pause under REVIEW");
check(/RECORD/.test(img("record")), "record key shows RECORD");

step = "pov1";
press("pov1");
await sleep(1200);
check(/WATCHING/.test(img("pov1")), "after tapping POV 1 its key says WATCHING");
step = "you";
press("you");
await sleep(1200);
check(!/WATCHING/.test(img("pov1")), "tapping Your view takes it back");

step = "marker";
press("marker");
await sleep(500);
check(/added/.test(img("marker")), "marker key flashes 'added'");
await sleep(1200);

step = "record-review";
press("record");
await sleep(800);
check(alerts.some((a) => a.step === "record-review"), "record key in Review: the key shows an alert (record is for Edit / Voiceover)");

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "index.html"), `<!doctype html><meta charset=utf-8><body style="background:#222;color:#ccc;font:12px sans-serif">` +
	["appear", "pov1", "you", "marker"].map((s) => `<h3>${s}</h3>` + frames.filter((f) => f.step === s).slice(-6).map((f) => `<div style="display:inline-block;margin:4px;text-align:center">${f.svg.replace('width="144" height="144"', 'width="120" height="120"')}<br>${f.context}</div>`).join("")).join("") + `</body>`);
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
child.kill();
server.close();
process.exit(failures ? 1 : 0);
