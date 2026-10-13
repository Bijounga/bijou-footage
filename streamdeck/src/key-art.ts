/**
 * Draws a key as a 144×144 SVG: a progress ring, a big readout in the middle, a small status
 * label above it and the mode name below. Kept to SVG Tiny features (paths, gradients, plain
 * text) because Stream Deck renders key images with Qt's SVG renderer.
 */

export const PAUSED_COLOR = "#FFB547";
export const OVER_COLOR = "#FF5C6C";
export const AWAY_COLOR = "#8A93A6";
const INK = "#F4F6FA";

export type KeyArt = {
	/** Ring and glow color. */
	color: string;
	/** Filled part of the ring, 0–1, drawn clockwise from 12 o'clock. Null draws only the track. */
	fraction: number | null;
	/** Big center text. */
	big: string;
	/** Small all-caps label above the readout, e.g. PAUSED. */
	label?: string;
	labelColor?: string;
	/** Line under the readout, usually the mode name. */
	caption?: string;
	/** Fades the whole key, for keys that aren't the running timer. */
	dim?: boolean;
	/** Shows a play glyph above the readout (an idle key that's ready to start). */
	play?: boolean;
	/** Draws a check mark in place of the readout (something just got done). */
	check?: boolean;
	/** Draws a window icon in place of the readout: an arrow out of it, or back into it. */
	glyph?: "popout" | "dock" | "rec" | "stop" | "shield";
};

/** A key that's mostly words: a small label on top and up to four wrapped lines. */
export type TextArt = {
	color: string;
	label: string;
	text: string;
	dim?: boolean;
};

const SIZE = 144;
const CENTER = 72;
const RADIUS = 60;
const STROKE = 7;
const FONT = "Segoe UI";

export function renderKey(art: KeyArt): string {
	const { color } = art;
	const parts: string[] = [];

	parts.push(
		`<defs><radialGradient id="glow" cx="50%" cy="50%" r="60%">` +
			`<stop offset="0%" stop-color="${color}" stop-opacity="0.24"/>` +
			`<stop offset="100%" stop-color="${color}" stop-opacity="0"/>` +
			`</radialGradient></defs>`,
		`<rect width="${SIZE}" height="${SIZE}" fill="#0B0D12"/>`,
		`<rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>`,
		// Track.
		`<circle cx="${CENTER}" cy="${CENTER}" r="${RADIUS}" fill="none" stroke="${color}" stroke-opacity="0.2" stroke-width="${STROKE}"/>`
	);

	if (art.fraction !== null && art.fraction > 0) {
		parts.push(ring(art.fraction, color));
	}

	if (art.glyph) {
		// Icon keys: the label sits higher to make room for the window glyph.
		if (art.label) parts.push(text(art.label, 42, 12, art.labelColor ?? color, 700));
		parts.push(art.glyph === "popout" || art.glyph === "dock" ? windowGlyph(art.glyph, color) : footageGlyph(art.glyph, color));
	} else if (art.play) {
		parts.push(`<path d="M66 37 L80 45 L66 53 Z" fill="${color}"/>`);
	} else if (art.label) {
		parts.push(text(art.label, 52, 13, art.labelColor ?? color, 700));
	}

	if (art.glyph) {
		// Drawn above.
	} else if (art.check) {
		parts.push(`<path d="M50 74 L65 89 L94 58" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`);
	} else {
		parts.push(text(art.big, 86, bigSize(art.big), INK, 600));
	}

	if (art.caption) {
		parts.push(text(truncate(art.caption, 11), 106, 14, INK, 400, 0.72));
	}

	const body = parts.join("");
	const content = art.dim ? `<g opacity="0.42">${body}</g>` : body;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${content}</svg>`;
}

export function renderText(art: TextArt): string {
	const { color } = art;
	const lines = wrap(art.text, 13, 4);
	const lineHeight = 20;
	const top = 92 - ((lines.length - 1) * lineHeight) / 2;

	const parts = [
		`<defs><radialGradient id="glow" cx="50%" cy="35%" r="70%">` +
			`<stop offset="0%" stop-color="${color}" stop-opacity="0.2"/>` +
			`<stop offset="100%" stop-color="${color}" stop-opacity="0"/>` +
			`</radialGradient></defs>`,
		`<rect width="${SIZE}" height="${SIZE}" fill="#0B0D12"/>`,
		`<rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>`,
		text(art.label, 30, 12, color, 700),
		`<rect x="58" y="39" width="28" height="3" rx="1.5" fill="${color}" fill-opacity="0.7"/>`,
		...lines.map((line, i) => text(line, top + i * lineHeight, 16, INK, 600))
	];

	const body = parts.join("");
	const content = art.dim ? `<g opacity="0.42">${body}</g>` : body;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${content}</svg>`;
}

/** Greedy word wrap by character count; the last line gets an ellipsis if text is left over. */
function wrap(value: string, perLine: number, maxLines: number): string[] {
	const words = value.trim().split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const chunk = word.length > perLine ? word.slice(0, perLine - 1) + "…" : word;
		if (line.length === 0) line = chunk;
		else if (line.length + 1 + chunk.length <= perLine) line += " " + chunk;
		else {
			lines.push(line);
			line = chunk;
		}
	}
	if (line) lines.push(line);
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		kept[maxLines - 1] = kept[maxLines - 1].slice(0, perLine - 1).trimEnd() + "…";
		return kept;
	}
	return lines.length ? lines : [""];
}

/** Bijou Footage's glyphs: record (a dot), stop (a square), a Premiere marker (a shield). */
function footageGlyph(kind: "rec" | "stop" | "shield", color: string): string {
	if (kind === "rec") return `<circle cx="72" cy="72" r="17" fill="${color}"/>`;
	if (kind === "stop") return `<rect x="57" y="57" width="30" height="30" rx="5" fill="${color}"/>`;
	return `<path d="M56 52 H88 V74 L72 92 L56 74 Z" fill="${color}" stroke="#0B0D12" stroke-opacity="0.5" stroke-width="2" stroke-linejoin="round"/>`;
}

/** A window with an arrow leaving it (pop out) or coming back into it (dock). */
function windowGlyph(kind: "popout" | "dock", color: string): string {
	const line = `fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"`;
	const frame = `<path d="M74 54 H60 a6 6 0 0 0 -6 6 V82 a6 6 0 0 0 6 6 H82 a6 6 0 0 0 6 -6 V68" stroke="${INK}" ${line}/>`;
	const arrow =
		kind === "popout"
			? `<path d="M70 72 L92 50 M79 50 H92 V63" stroke="${color}" ${line}/>`
			: `<path d="M92 50 L71 71 M71 58 V71 H84" stroke="${color}" ${line}/>`;
	return frame + arrow;
}

export function toDataUrl(svg: string): string {
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

function ring(fraction: number, color: string): string {
	if (fraction >= 0.9999) {
		return `<circle cx="${CENTER}" cy="${CENTER}" r="${RADIUS}" fill="none" stroke="${color}" stroke-width="${STROKE}"/>`;
	}

	const angle = fraction * 2 * Math.PI;
	const x = CENTER + RADIUS * Math.sin(angle);
	const y = CENTER - RADIUS * Math.cos(angle);
	const largeArc = fraction > 0.5 ? 1 : 0;
	const arc =
		`<path d="M ${CENTER} ${CENTER - RADIUS} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${x.toFixed(2)} ${y.toFixed(2)}" ` +
		`fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round"/>`;
	// A bright tip on the moving end — the part of the ring that visibly ticks.
	const tip = `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4.5" fill="${INK}"/>`;
	return arc + tip;
}

function bigSize(value: string): number {
	if (value.length <= 3) return 40;
	if (value.length <= 5) return 36;
	if (value.length <= 6) return 31;
	if (value.length <= 7) return 28;
	return 22;
}

function text(value: string, y: number, size: number, fill: string, weight: number, opacity = 1): string {
	const fade = opacity < 1 ? ` fill-opacity="${opacity}"` : "";
	return (
		`<text x="${CENTER}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" ` +
		`font-weight="${weight}" fill="${fill}"${fade}>${escapeXml(value)}</text>`
	);
}

function truncate(value: string, max: number): string {
	return value.length <= max ? value : value.slice(0, max - 1).trimEnd() + "…";
}

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
