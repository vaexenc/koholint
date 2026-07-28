// minimal level-gated console logger with ISO-timestamp + level prefix. no
// external deps; LOG_LEVEL env (default "info") chooses the floor.

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = {debug: 10, info: 20, warn: 30, error: 40};

function resolveLevel(): Level {
	const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
	if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
	return "info";
}

const FLOOR = ORDER[resolveLevel()];

function emit(level: Level, args: unknown[]): void {
	if (ORDER[level] < FLOOR) return;
	const prefix = `${new Date().toISOString()} [${level}]`;
	if (level === "error") console.error(prefix, ...args);
	else if (level === "warn") console.warn(prefix, ...args);
	else console.log(prefix, ...args);
}

export const log = {
	debug: (...args: unknown[]) => emit("debug", args),
	info: (...args: unknown[]) => emit("info", args),
	warn: (...args: unknown[]) => emit("warn", args),
	error: (...args: unknown[]) => emit("error", args),
};
