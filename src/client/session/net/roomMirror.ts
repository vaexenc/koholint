import {
	pushBacklog,
	type ChatMessage,
	type ConnId,
	type PlayerSnapshot,
	type ServerMessage,
	type ServerWelcome,
} from "@/shared/protocol";
import type {DecodedSnapshot, SnapshotPose} from "@/shared/protocol/snapshot";

// leader-side cache of everything a welcome carries, kept current from the
// live message stream. lets the leader hand a tab that opens mid-session a
// welcome equivalent to what the server would send on a fresh hello, without
// opening a second connection for the shared identity.
export class RoomMirror {
	private welcome: ServerWelcome | null = null;
	private players = new Map<ConnId, PlayerSnapshot>();
	private chat: ChatMessage[] = [];
	private serverTick = 0;
	// the poses this connection's remotes currently show, maintained from the
	// interest-culled delta stream (upsert on pose, delete on removed/leave).
	// a late tab needs this baseline: static visible players never re-send.
	private posesByIdIndex = new Map<number, SnapshotPose>();
	private lastAck = 0;

	hasWelcome(): boolean {
		return this.welcome !== null;
	}

	applyServer(msg: ServerMessage): void {
		switch (msg.type) {
			case "welcome":
				this.welcome = msg;
				this.serverTick = msg.serverTick;
				this.lastAck = msg.serverTick;
				this.players = new Map(msg.players.map((p) => [p.connId, p]));
				// rebuild through pushBacklog so the per-kind caps hold even if the
				// payload arrives over-cap; a capped payload copies through unchanged.
				this.chat = [];
				for (const m of msg.chatBacklog) pushBacklog(this.chat, m);
				// a fresh welcome means a fresh server-side interest baseline.
				this.posesByIdIndex.clear();
				return;
			case "join":
				this.players.set(msg.player.connId, msg.player);
				return;
			case "leave": {
				const p = this.players.get(msg.connId);
				if (p) this.posesByIdIndex.delete(p.idIndex);
				this.players.delete(msg.connId);
				return;
			}
			case "profileChanged": {
				const p = this.players.get(msg.connId);
				if (p) this.players.set(msg.connId, {...p, profile: msg.profile, color: msg.color});
				return;
			}
			case "chat":
				pushBacklog(this.chat, msg.message);
				return;
			case "profileRejected":
				return;
		}
	}

	// keeps roster poses current so a synthesized welcome places characters
	// where they stand now, not where they stood at join time.
	applySnapshot(snap: DecodedSnapshot): void {
		if (snap.serverTick > this.serverTick) this.serverTick = snap.serverTick;
		if (snap.ackTickForYou > this.lastAck) this.lastAck = snap.ackTickForYou;
		for (const idIndex of snap.removed) this.posesByIdIndex.delete(idIndex);
		for (const pose of snap.poses) this.posesByIdIndex.set(pose.idIndex, pose);
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

	synthesizeSnapshot(): DecodedSnapshot | null {
		if (!this.welcome) return null;
		return {
			serverTick: this.serverTick,
			ackTickForYou: this.lastAck,
			poses: [...this.posesByIdIndex.values()],
			removed: [],
		};
	}
}
