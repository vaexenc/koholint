import type {
	ChatMessage,
	ConnId,
	DecodedSnapshot,
	PlayerSnapshot,
	ServerMessage,
	ServerWelcome,
} from "@/protocol";

// mirrors the server's chat backlog cap (server/rooms.ts CHAT_BACKLOG_SIZE) so
// a synthesized welcome hands a late tab the same history depth a real one would.
const CHAT_BACKLOG_SIZE = 200;

// leader-side cache of everything a welcome carries, kept current from the
// live message stream. lets the leader hand a tab that opens mid-session a
// welcome equivalent to what the server would send on a fresh hello, without
// opening a second connection for the shared identity.
export class RoomMirror {
	private welcome: ServerWelcome | null = null;
	private players = new Map<ConnId, PlayerSnapshot>();
	private chat: ChatMessage[] = [];
	private serverTick = 0;

	hasWelcome(): boolean {
		return this.welcome !== null;
	}

	applyServer(msg: ServerMessage): void {
		switch (msg.type) {
			case "welcome":
				this.welcome = msg;
				this.serverTick = msg.serverTick;
				this.players = new Map(msg.players.map((p) => [p.connId, p]));
				this.chat = msg.chatBacklog.slice(-CHAT_BACKLOG_SIZE);
				return;
			case "join":
				this.players.set(msg.player.connId, msg.player);
				return;
			case "leave":
				this.players.delete(msg.connId);
				return;
			case "profileChanged": {
				const p = this.players.get(msg.connId);
				if (p) this.players.set(msg.connId, {...p, profile: msg.profile, color: msg.color});
				return;
			}
			case "chat":
			case "presence":
			case "system":
				this.chat.push(msg.message);
				if (this.chat.length > CHAT_BACKLOG_SIZE)
					this.chat.splice(0, this.chat.length - CHAT_BACKLOG_SIZE);
				return;
			case "profileRejected":
				return;
		}
	}

	// keeps roster poses current so a synthesized welcome places characters
	// where they stand now, not where they stood at join time.
	applySnapshot(snap: DecodedSnapshot): void {
		if (snap.serverTick > this.serverTick) this.serverTick = snap.serverTick;
		if (this.players.size === 0) return;
		const byIdIndex = new Map<number, PlayerSnapshot>();
		for (const p of this.players.values()) byIdIndex.set(p.idIndex, p);
		for (const pose of snap.poses) {
			const p = byIdIndex.get(pose.idIndex);
			if (!p) continue;
			this.players.set(p.connId, {...p, x: pose.x, y: pose.y, facing: pose.facing});
		}
	}

	synthesizeWelcome(): ServerWelcome | null {
		const welcome = this.welcome;
		if (!welcome) return null;
		const self = this.players.get(welcome.connId);
		return {
			...welcome,
			serverTick: this.serverTick,
			serverTimeMs: Date.now(),
			spawn: self ? {x: self.x, y: self.y} : welcome.spawn,
			players: [...this.players.values()],
			chatBacklog: [...this.chat],
		};
	}
}
