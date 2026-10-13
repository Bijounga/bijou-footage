// Draws the plugin's images: list icons (white line art) and default key images as SVG — Stream
// Deck takes SVG — and the plugin icon as PNG (the app's icon, resized).
// node tools/make-icons.mjs   (sharp comes from the app's node_modules, one folder up)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "com.bijounga.bijoufootage.sdPlugin", "imgs");
fs.mkdirSync(out, { recursive: true });

const svg = (inner, size = 20) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20">${inner}</svg>`;
const W = "#FFFFFF";
const icons = {
	record: `<circle cx="10" cy="10" r="7.5" fill="none" stroke="${W}" stroke-width="1.6"/><circle cx="10" cy="10" r="4" fill="${W}"/>`,
	pov: `<rect x="1.5" y="3.5" width="17" height="13" rx="2" fill="none" stroke="${W}" stroke-width="1.6"/><rect x="10" y="9" width="7" height="6" rx="1" fill="${W}"/>`,
	marker: `<path d="M4.5 3 H15.5 V10.5 L10 17 L4.5 10.5 Z" fill="none" stroke="${W}" stroke-width="1.6" stroke-linejoin="round"/>`,
	action: `<path d="M11 2 L4 11 H9.5 L8.5 18 L16 8.5 H10.5 Z" fill="none" stroke="${W}" stroke-width="1.5" stroke-linejoin="round"/>`,
	category: `<rect x="2" y="4" width="16" height="12" rx="2.5" fill="none" stroke="${W}" stroke-width="1.6"/><path d="M8 7.5 L13.5 10 L8 12.5 Z" fill="${W}"/>`
};

// default key pictures (shown before the plugin draws, and in the action list preview)
const key = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#0B0D12"/>${inner}</svg>`;
const label = (t, y, c) => `<text x="72" y="${y}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="13" font-weight="700" fill="${c}">${t}</text>`;
const ring = (c) => `<circle cx="72" cy="72" r="60" fill="none" stroke="${c}" stroke-opacity="0.25" stroke-width="7"/>`;
const keys = {
	"record-key": ring("#FF4A58") + label("RECORD", 42, "#FF4A58") + `<circle cx="72" cy="72" r="17" fill="#FF4A58"/>`,
	"pov-key": ring("#4FD1C5") + label("POV", 52, "#4FD1C5") + `<text x="72" y="86" text-anchor="middle" font-family="Segoe UI, Arial" font-size="36" font-weight="600" fill="#F4F6FA">1</text>`,
	"marker-key": ring("#F2C230") + label("MARKER", 42, "#F2C230") + `<path d="M56 52 H88 V74 L72 92 L56 74 Z" fill="#F2C230"/>`,
	"action-key": ring("#33E1FF") + label("ACTION", 42, "#33E1FF") + `<path d="M76 52 L60 76 H72 L68 94 L86 68 H74 Z" fill="#F4F6FA"/>`
};

for (const [name, inner] of Object.entries(icons)) fs.writeFileSync(path.join(out, name + ".svg"), svg(inner, name === "category" ? 28 : 20));
for (const [name, k] of Object.entries(keys)) fs.writeFileSync(path.join(out, name + ".svg"), key(k));
// the plugin's own icon: the app's
const appIcon = path.join(here, "..", "..", "build", "icon.png");
await sharp(appIcon).resize(256, 256).png().toFile(path.join(out, "plugin.png"));
await sharp(appIcon).resize(512, 512).png().toFile(path.join(out, "plugin@2x.png"));
console.log("icons in", out);
