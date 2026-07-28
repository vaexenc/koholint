import type {ConnId, PlayerSnapshot, Profile, ServerWelcome} from "@/shared/protocol";
import {profileAccent} from "@/shared/sprites/profileAccent";
import type {HexColor} from "@/shared/sprites/types";
import {useMemo, useState} from "react";

// one player as the roster holds them. declared here rather than with the chat
// panel that renders it, so the roster owns its own row shape and the session
// layer never has to reach up into a component for a type.
export type PlayerListEntry = {
	readonly connId: ConnId;
	readonly name: string;
	readonly color: string;
	readonly avatarId: string;
	readonly paletteId: string | null;
};

// the one projection from an identity onto a roster row. every source — a
// welcome/join snapshot, a profileChanged frame, our own profile — already
// carries a connId, a profile and an accent, so they all flatten the same way
// and the roster can't describe the same player differently depending on which
// message put them there.
function rosterRow(connId: ConnId, profile: Profile, color: HexColor): PlayerListEntry {
	return {
		connId,
		name: profile.name,
		color,
		avatarId: profile.avatarId,
		paletteId: profile.paletteId,
	};
}

// everything that changes who is in the room.
export type RosterActions = {
	// replaces the roster wholesale, as a fresh welcome does.
	readonly reset: (welcome: ServerWelcome, selfProfile: Profile) => void;
	readonly add: (player: PlayerSnapshot) => void;
	readonly remove: (connId: ConnId) => void;
	readonly setProfile: (connId: ConnId, profile: Profile, color: HexColor) => void;
	// our own row. self has no broadcast to read a color from, so it derives the
	// accent the same way the server would.
	readonly setSelf: (connId: ConnId, profile: Profile) => void;
};

// the room's roster as the player list renders it. held as a map so a single row
// can be replaced or dropped without touching the rest, and handed out as an
// array the list can sort.
//
// the actions close over nothing but `setByConnId`, which react guarantees is
// constant, so the whole table is built once rather than re-memoized per field —
// its identity is then constant by construction instead of by keeping five
// dependency lists honest. effects that fan a profile edit out to the roster can
// depend on it without re-firing.
export function usePlayerRoster(): [readonly PlayerListEntry[], RosterActions] {
	const [byConnId, setByConnId] = useState<ReadonlyMap<ConnId, PlayerListEntry>>(() => new Map());

	const [actions] = useState<RosterActions>(() => {
		// every update replaces the map rather than mutating it, so react sees
		// the change.
		const put = (row: PlayerListEntry) =>
			setByConnId((prev) => new Map(prev).set(row.connId, row));
		return {
			reset: (welcome, selfProfile) => {
				const next = new Map<ConnId, PlayerListEntry>();
				for (const p of welcome.players)
					next.set(p.connId, rosterRow(p.connId, p.profile, p.color));
				// the roster we're handed may predate our own join.
				if (!next.has(welcome.connId))
					next.set(
						welcome.connId,
						rosterRow(welcome.connId, selfProfile, profileAccent(selfProfile))
					);
				setByConnId(next);
			},
			add: (player) => put(rosterRow(player.connId, player.profile, player.color)),
			remove: (connId) =>
				setByConnId((prev) => {
					if (!prev.has(connId)) return prev;
					const next = new Map(prev);
					next.delete(connId);
					return next;
				}),
			setProfile: (connId, profile, color) => put(rosterRow(connId, profile, color)),
			setSelf: (connId, profile) => put(rosterRow(connId, profile, profileAccent(profile))),
		};
	});

	// the player list is a memo component that re-sorts on a new array, so this
	// tracks the map rather than the render.
	const players = useMemo(() => [...byConnId.values()], [byConnId]);
	return [players, actions];
}
