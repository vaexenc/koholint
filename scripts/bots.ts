// headless load-test bots: connect N clients that walk randomly and chat.
// usage: npx tsx scripts/bots.ts [count] [--url ws://host:port/ws]
import {AVATAR_IDS} from "@/components/avatar-picker/avatarIds";
import type {CharacterInput} from "@/game/types";
import {isRecord} from "@/lib/isRecord";
import type {ClientMessage} from "@/protocol";
import {decodeSnapshot} from "@/protocol";
import WebSocket, {type RawData} from "ws";

const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;
// stamp inputs a few ticks ahead so they arrive before the server's counter
// reaches them (it consumes an input only on the tick matching its key), and
// send a rolling window each frame so serverTick+1 is always populated —
// otherwise the server stamps NEUTRAL between frames and the character stops.
const INPUT_LEAD_TICKS = 4;
const INPUT_WINDOW_TICKS = 6;

const args = process.argv.slice(2);
const urlFlag = args.indexOf("--url");
const url = urlFlag !== -1 ? args[urlFlag + 1] : "ws://127.0.0.1:3000/ws";
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 10);

const CHATTER = [
	"hi",
	"hello there",
	"anyone here?",
	"wanna race?",
	"nice map",
	"where do i go",
	"beep boop",
	"im lost",
	"watch out",
	"gg",
	"following you",
	"brb",
	"this is fun",
	"over here!",
	"hehe",
];

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

function toBuffer(data: RawData): Buffer {
	if (Array.isArray(data)) return Buffer.concat(data);
	if (Buffer.isBuffer(data)) return data;
	return Buffer.from(new Uint8Array(data));
}

function send(ws: WebSocket, msg: ClientMessage): void {
	ws.send(JSON.stringify(msg));
}

function randomInput(): CharacterInput {
	// bias toward a single cardinal-ish direction, sometimes idle
	const r = Math.random();
	if (r < 0.15) return {up: false, down: false, left: false, right: false};
	return {
		up: Math.random() < 0.4 && r < 0.55,
		down: Math.random() < 0.4 && r >= 0.55,
		left: Math.random() < 0.4 && r < 0.35,
		right: Math.random() < 0.4 && r >= 0.75,
	};
}

function spawnBot(index: number): void {
	const name = `bot-${index}`;
	const ws = new WebSocket(url);
	let baseTick = 0;
	let baseTimeMs = 0;
	let ackTick = 0;
	let input = randomInput();
	let loop: NodeJS.Timeout | undefined;
	let chatTimer: NodeJS.Timeout | undefined;
	let steerTimer: NodeJS.Timeout | undefined;

	// drift-free estimate of the server's current tick from wall-clock elapsed,
	// so stamps track real time instead of accumulating setInterval jitter.
	const estServerTick = (): number => baseTick + Math.round((Date.now() - baseTimeMs) / TICK_MS);

	ws.on("open", () => {
		send(ws, {type: "hello", name, avatarId: pick(AVATAR_IDS), paletteId: null});
	});

	ws.on("message", (data, isBinary) => {
		if (isBinary) {
			const buf = toBuffer(data);
			const copy = new ArrayBuffer(buf.byteLength);
			new Uint8Array(copy).set(buf);
			const snap = decodeSnapshot(copy);
			if (snap.ackTickForYou > ackTick) ackTick = snap.ackTickForYou;
			return;
		}
		const msg: unknown = JSON.parse(toBuffer(data).toString("utf8"));
		if (isRecord(msg) && msg.type === "welcome" && isRecord(msg.spawn)) {
			baseTick = Number(msg.serverTick);
			baseTimeMs = Date.now();
			ackTick = baseTick;
			console.log(`${name} connected (spawn ${Number(msg.spawn.x)},${Number(msg.spawn.y)})`);
			start();
		}
	});

	function start(): void {
		loop = setInterval(() => {
			const first = estServerTick() + INPUT_LEAD_TICKS;
			const inputs = Array.from({length: INPUT_WINDOW_TICKS}, (_, k) => ({
				tick: first + k,
				input,
			}));
			send(ws, {type: "input", ackTick, inputs});
		}, TICK_MS);

		const steer = (): void => {
			input = randomInput();
			steerTimer = setTimeout(steer, 800 + Math.random() * 2500);
		};
		steer();

		const chat = (): void => {
			send(ws, {type: "chat", text: pick(CHATTER)});
			chatTimer = setTimeout(chat, 6000 + Math.random() * 12000);
		};
		chatTimer = setTimeout(chat, 2000 + Math.random() * 8000);
	}

	const cleanup = (): void => {
		clearInterval(loop);
		clearTimeout(chatTimer);
		clearTimeout(steerTimer);
	};

	ws.on("close", (code) => {
		cleanup();
		console.log(`${name} closed (${code})`);
	});
	ws.on("error", (err) => {
		cleanup();
		console.log(`${name} error: ${err.message}`);
	});
}

console.log(`spawning ${count} bots -> ${url}`);
for (let i = 0; i < count; i++) {
	setTimeout(() => spawnBot(i + 1), i * 10);
}

process.on("SIGINT", () => process.exit(0));
