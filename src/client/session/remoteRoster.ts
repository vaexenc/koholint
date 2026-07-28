import {appearanceOf, applyAppearance} from "@/client/session/appearance";
import type {GameHostContext} from "@/client/session/gameHost";
import {applyRemoteInterp, recordRemotePose, type RemoteEntry} from "@/client/session/remoteInterp";
import {
	createBasicCharacter,
	StaticInputProvider,
	type BasicCharacter,
	type World,
} from "@/shared/game";
import type {ConnId, PlayerSnapshot, Profile} from "@/shared/protocol";
import type {SnapshotPose} from "@/shared/protocol/snapshot";

// every player in the room but the local one. owns the roster, their characters,
// and which of them are currently in the world — three things the game above it
// never has to hold, so that game is left with the self character, prediction and
// the clock.
//
// registration and materialization are deliberately separate: snapshots are
// interest-culled deltas, so an entry exists for every rostered player while the
// character only enters the world once a pose arrives for it (record) and leaves
// again when the removed list names it (hide). the two indexes exist because both
// keys are load-bearing — the wire addresses players by idIndex, chat and
// presence by connId — and keeping them in step is this class's whole invariant.
export class RemoteRoster {
	private readonly byIdIndex = new Map<number, RemoteEntry>();
	private readonly byConnId = new Map<ConnId, RemoteEntry>();
	private readonly world: World;
	private readonly renderer: GameHostContext["renderer"];

	constructor(world: World, renderer: GameHostContext["renderer"]) {
		this.world = world;
		this.renderer = renderer;
	}

	get size(): number {
		return this.byIdIndex.size;
	}

	// whether this connId belongs to someone in the room at all — rostered, even
	// if their character isn't materialized right now.
	has(connId: ConnId): boolean {
		return this.byConnId.has(connId);
	}

	// registers the player and preloads its sprite, but does not materialize the
	// character; the first pose does that. idempotent, so a reconnect's duplicate
	// `join` is ignored rather than doubling the entry.
	add(player: PlayerSnapshot): void {
		if (this.byConnId.has(player.connId)) return;
		const character = createBasicCharacter({
			id: `remote:${player.connId}`,
			...appearanceOf(player.profile),
			x: player.x,
			y: player.y,
			facing: player.facing,
		});
		const entry: RemoteEntry = {
			connId: player.connId,
			idIndex: player.idIndex,
			profile: player.profile,
			color: player.color,
			character,
			samples: [],
			visible: false,
		};
		this.byIdIndex.set(player.idIndex, entry);
		this.byConnId.set(player.connId, entry);
		this.renderer.ensureLoaded([character]).catch(() => {});
	}

	// true when a remote was actually dropped, so the caller can retire whatever
	// else it hangs off that identity (chat bubbles) without having to ask first.
	remove(connId: ConnId): boolean {
		const entry = this.byConnId.get(connId);
		if (!entry) return false;
		this.hideEntry(entry);
		this.byIdIndex.delete(entry.idIndex);
		this.byConnId.delete(connId);
		return true;
	}

	// empties the roster, returning who was in it — a re-welcome describes a room
	// from scratch, and the caller has its own per-identity state to retire.
	clear(): ConnId[] {
		const dropped = [...this.byConnId.keys()];
		for (const connId of dropped) this.remove(connId);
		return dropped;
	}

	setProfile(connId: ConnId, profile: Profile, color: RemoteEntry["color"]): void {
		const entry = this.byConnId.get(connId);
		if (!entry) return;
		entry.profile = profile;
		entry.color = color;
		applyAppearance(this.renderer, entry.character, profile);
	}

	// an authoritative pose for a rostered remote. the first one after it entered
	// the recipient's interest area materializes the character and seeds its
	// sample buffer, so the sprite takes its on-screen position from
	// interpolation before it ever renders.
	record(pose: SnapshotPose, at: number): void {
		const entry = this.byIdIndex.get(pose.idIndex);
		if (!entry) return;
		if (!entry.visible) {
			entry.visible = true;
			entry.samples.length = 0;
			this.world.addCharacter(entry.character, new StaticInputProvider());
		}
		recordRemotePose(entry, pose, at);
	}

	// left the interest area: the character leaves the world, the roster entry
	// stays, so a later pose can bring it straight back.
	hide(idIndex: number): void {
		const entry = this.byIdIndex.get(idIndex);
		if (entry) this.hideEntry(entry);
	}

	// poses every materialized remote at `renderAt`. entries that aren't in the
	// world hold no samples, so they cost a no-op rather than needing a filter.
	interpolate(renderAt: number): void {
		for (const entry of this.byIdIndex.values()) applyRemoteInterp(entry, renderAt);
	}

	characterFor(connId: ConnId): BasicCharacter | null {
		const entry = this.byConnId.get(connId);
		return entry?.visible ? entry.character : null;
	}

	// every remote currently materialized, for whatever the game draws over them.
	*inWorld(): Generator<RemoteEntry> {
		for (const entry of this.byConnId.values()) if (entry.visible) yield entry;
	}

	private hideEntry(entry: RemoteEntry): void {
		if (!entry.visible) return;
		entry.visible = false;
		entry.samples.length = 0;
		this.world.removeCharacter(entry.character.id);
	}
}
