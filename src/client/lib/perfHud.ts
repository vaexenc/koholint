// in-canvas perf HUD for chasing frame drops and event-loop stalls. shown
// only while ?perf is in the url. producers feed three primitives — gauges
// (last value), samples (avg/max over the last window) and counts (rate/s) —
// and the render loop draws the digest as text in the screen-overlay pass:
// no DOM, no react, so the HUD can't perturb what it measures. everything
// no-ops when disabled.

import {copyText} from "@/client/lib/clipboard";

const WINDOW_MS = 500;

function readEnabled(): boolean {
	const params = new URLSearchParams(window.location.search);
	return params.has("perf") && params.get("perf") !== "0";
}

export const perfHudEnabled = readEnabled();

type Acc = {sum: number; count: number; max: number};

const gauges = new Map<string, number>();
const samples = new Map<string, Acc>();
const counts = new Map<string, number>();

export function perfGauge(key: string, value: number): void {
	if (!perfHudEnabled) return;
	gauges.set(key, value);
}

export function perfSample(key: string, value: number): void {
	if (!perfHudEnabled) return;
	let acc = samples.get(key);
	if (!acc) {
		acc = {sum: 0, count: 0, max: 0};
		samples.set(key, acc);
	}
	acc.sum += value;
	acc.count++;
	if (value > acc.max) acc.max = value;
}

export function perfCount(key: string, n = 1): void {
	if (!perfHudEnabled) return;
	counts.set(key, (counts.get(key) ?? 0) + n);
}

// samples how long `work` took. the disabled path is a plain call — no clock
// reads at all — so the render loop can be instrumented at every step it cares
// about without paying for it when nobody is watching.
export function timed<T>(key: string, work: () => T): T {
	if (!perfHudEnabled) return work();
	const start = performance.now();
	const result = work();
	perfSample(key, performance.now() - start);
	return result;
}

// user-timing census: counts marks/measures by name so a flooding emitter
// names itself in the HUD (react's dev build is the usual suspect; see the
// buffer-clearing interval in main.tsx). buffered delivery also counts
// entries that predate the HUD.
const timingCounts = new Map<string, number>();
let timingTotal = 0;

if (perfHudEnabled && typeof PerformanceObserver !== "undefined") {
	try {
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				timingTotal++;
				const key = entry.name.slice(0, 28) || "(unnamed)";
				timingCounts.set(key, (timingCounts.get(key) ?? 0) + 1);
			}
		});
		observer.observe({type: "mark", buffered: true});
		observer.observe({type: "measure", buffered: true});
	} catch {
		// user-timing observation unavailable; the census just stays empty.
	}
}

// event-loop lag probe: how late a 250ms timer fires. catches saturation the
// rAF timings can't see — GC pauses, message-handler storms, other timers.
if (perfHudEnabled) {
	let last = performance.now();
	setInterval(() => {
		const now = performance.now();
		perfSample("loop lag ms", Math.max(0, now - last - 250));
		last = now;
	}, 250);
	mountCopyButton();
}

// one dom element so the digest can be pasted into a bug report; the HUD
// itself stays on the canvas, drawn just below this button.
function mountCopyButton(): void {
	const button = document.createElement("button");
	button.textContent = "copy perf";
	Object.assign(button.style, {
		position: "fixed",
		top: "8px",
		left: "8px",
		zIndex: "9999",
		font: "11px ui-monospace, Consolas, monospace",
		color: "#ddd",
		background: "rgba(0, 0, 0, 0.65)",
		border: "1px solid rgba(255, 255, 255, 0.2)",
		borderRadius: "4px",
		padding: "2px 8px",
		cursor: "pointer",
	});
	button.addEventListener("click", () => {
		const flash = (label: string): void => {
			button.textContent = label;
			setTimeout(() => {
				button.textContent = "copy perf";
			}, 1200);
		};
		const payload = `koholint perf ${new Date().toISOString()}\n${lines.join("\n")}`;
		void copyText(payload).then((ok) => flash(ok ? "copied" : "copy failed"));
	});
	document.body.append(button);
}

let lines: string[] = [];
let lastBuildAt = 0;

function buildLines(elapsedMs: number): string[] {
	const out: string[] = [];
	const secs = elapsedMs / 1000;
	for (const [key, n] of [...counts].sort(([a], [b]) => a.localeCompare(b)))
		out.push(`${key}/s ${(n / secs).toFixed(1)}`);
	for (const [key, acc] of [...samples].sort(([a], [b]) => a.localeCompare(b)))
		out.push(
			`${key} ${(acc.sum / Math.max(1, acc.count)).toFixed(1)} max ${acc.max.toFixed(1)}`
		);
	for (const [key, value] of [...gauges].sort(([a], [b]) => a.localeCompare(b)))
		out.push(`${key} ${Math.round(value)}`);
	out.push(`user timing seen ${timingTotal}`);
	for (const [name, n] of [...timingCounts].sort((a, b) => b[1] - a[1]).slice(0, 4))
		out.push(`ut ${n} ${name}`);
	counts.clear();
	for (const acc of samples.values()) {
		acc.sum = 0;
		acc.count = 0;
		acc.max = 0;
	}
	return out;
}

// draws the digest top-left. caller has the context in CSS-pixel space.
export function drawPerfHud(ctx: CanvasRenderingContext2D, now: number): void {
	if (!perfHudEnabled) return;
	if (now - lastBuildAt >= WINDOW_MS) {
		lines = buildLines(now - lastBuildAt || WINDOW_MS);
		lastBuildAt = now;
	}
	if (lines.length === 0) return;
	const lineHeight = 14;
	// below the copy button, which sits fixed at the top-left corner.
	const top = 34;
	ctx.save();
	ctx.font = "11px ui-monospace, Consolas, monospace";
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
	ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
	ctx.fillRect(6, top, width + 12, lines.length * lineHeight + 10);
	ctx.fillStyle = "#7fff9f";
	for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 12, top + 6 + i * lineHeight);
	ctx.restore();
}
