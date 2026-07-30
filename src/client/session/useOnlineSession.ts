import {readAdminToken} from "@/client/lib/adminToken";
import {useLatestGetter, useLatestRef} from "@/client/lib/hooks/useLatestRef";
import {connectionErrorText} from "@/client/session/net/connectionErrorCopy";
import {TabSyncedClient} from "@/client/session/net/tabSync";
import {
	buildWsUrl,
	type ConnectionError,
	type ConnectionStatus,
} from "@/client/session/net/wsClient";
import type {OnlineGame} from "@/client/session/onlineGame";
import {randomProfile} from "@/client/session/randomProfile";
import {usePlayerRoster, type PlayerListEntry} from "@/client/session/usePlayerRoster";
import {chatDisplayText, type ChatSettings} from "@/client/settings/chatSettings";
import {
	pushBacklog,
	type ChatMessage,
	type ConnId,
	type PlayerSnapshot,
	type Profile,
	type ServerMessage,
	type ServerProfileChanged,
	type ServerWelcome,
} from "@/shared/protocol";
import type {DecodedSnapshot} from "@/shared/protocol/snapshot";
import {validateName} from "@/shared/protocol/validateName";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type Dispatch,
	type RefObject,
	type SetStateAction,
} from "react";

// the online map's whole server side: the connection, the join lifecycle, and
// the translation of the server stream into the page state the chrome renders.
// none of it touches JSX, and the offline page needs none of it — so the page
// component is left as the wiring its offline counterpart already is.
//
// the world half of every message is the game's; this owns the page half, and
// every case below hands off to both in the same place.

// how long a join may still be in flight once the world is drawable, before the
// page gives up and hands the player to the offline map. only applies while the
// connection is silent — an outright failure hands off at once — so this covers
// a slow handshake, not a server that is plainly down.
const JOIN_GRACE_MS = 1500;

// what a join that outran its grace reports: no close event named a reason
// within it — a hung server, or a leader tab whose retry backoff hasn't
// re-emitted one yet — so the claim is the grace's own. a failure always
// carrying a reason is what keeps the fallback pill's hover from ever being
// empty.
const JOIN_TIMEOUT_ERROR: ConnectionError = {kind: "unreachable"};

// what the player sees at each step:
//   preMap → loading (map fetch in flight)
//   joining → loading (ws hello in flight; players auto-join with a random or
//             saved identity, so there's no first-run picker to show)
//   joined → game HUD + chat panel
// the two loading phases only show the loader on a cold start: a player who has
// already been in the world waits out a re-join on the map itself, with the pill
// reporting the connection. and a cold start only waits out the join for as long
// as JOIN_GRACE_MS — past that the offline map takes over, so assets are the
// only real gate.
type JoinPhase = "preMap" | "joining" | "joined";

type JoinPhaseDeps = {
	// the world can be drawn: assets are in, so the player is owed a game.
	readonly mapReady: boolean;
	readonly connectionError: ConnectionError | null;
	// opens the connection, on the one transition out of preMap.
	readonly onJoin: () => void;
	// the join can't be completed; the route takes over from here. the reason
	// rides along — this session is about to unmount, and the offline map that
	// replaces it still owes the player an explanation.
	readonly onFailed: (error: ConnectionError) => void;
};

// the join as one machine with two transitions and one external event, rather
// than as separate effects that each re-derive part of it. returns the phase and
// the "we're in" signal the welcome handler fires.
function useJoinPhase({
	mapReady,
	connectionError,
	onJoin,
	onFailed,
}: JoinPhaseDeps): [JoinPhase, () => void] {
	const [phase, setPhase] = useState<JoinPhase>("preMap");

	// fires at most once, because entering `joining` is the only way out of
	// `preMap`.
	useEffect(() => {
		if (phase !== "preMap" || !mapReady) return;
		setPhase("joining");
		onJoin();
	}, [phase, mapReady, onJoin]);

	// the loading screen is there to cover assets, not the connection: the moment
	// the world can be drawn without missing sprites, the player is owed a
	// playable game. a join still outstanding then hands back to the route, which
	// swaps in the offline map and keeps working on the connection from there — at
	// once if the connection has already failed, otherwise after a grace, in case
	// the welcome is only just behind. pre-join only; after the welcome a dropped
	// socket is the client's own reconnect to handle and the game stays live.
	useEffect(() => {
		if (!mapReady || phase === "joined") return;
		if (connectionError) {
			onFailed(connectionError);
			return;
		}
		const handle = window.setTimeout(() => onFailed(JOIN_TIMEOUT_ERROR), JOIN_GRACE_MS);
		return () => window.clearTimeout(handle);
	}, [mapReady, phase, connectionError, onFailed]);

	const markJoined = useCallback(() => setPhase("joined"), []);
	return [phase, markJoined];
}

// the page's live backlog obeys the same per-kind caps the server applies to
// the one it hands a joining client, so a tab that has been open for hours and
// one that just joined show the same history — and presence churn can't evict
// conversation in either.
function appendChat(prev: readonly ChatMessage[], message: ChatMessage): ChatMessage[] {
	const next = [...prev];
	pushBacklog(next, message);
	return next;
}

function sameProfile(a: Profile, b: Profile): boolean {
	return a.name === b.name && a.avatarId === b.avatarId && a.paletteId === b.paletteId;
}

// copy for the loading screen while the join is stuck. a non-terminal status
// means WsClient is still retrying, so say so.
function connectionMessage(
	error: ConnectionError | null,
	status: ConnectionStatus
): string | undefined {
	if (!error) return status === "closed" ? "Disconnected" : undefined;
	const base = connectionErrorText(error);
	return status === "closed" ? base : `${base}, retrying...`;
}

export type OnlineSessionDeps = {
	// the live game for this map load, which every server message applies its
	// world half to. null until `init` has built one.
	readonly gameRef: RefObject<OnlineGame | null>;
	readonly profile: Profile;
	readonly setProfile: Dispatch<SetStateAction<Profile>>;
	// decides which variant of a chat line goes into an in-world bubble.
	readonly obscenityMode: ChatSettings["obscenityMode"];
	readonly onJoinFailed: (error: ConnectionError) => void;
};

export type OnlineSession = {
	// the tab's connection, for the page's own sends (chat, view, teleport) and
	// the reconnect button.
	readonly net: TabSyncedClient;
	readonly status: ConnectionStatus;
	// why the last attempt failed, for the connection pill's hover; null while
	// the connection is healthy.
	readonly connectionError: ConnectionError | null;
	readonly joined: boolean;
	readonly messages: readonly ChatMessage[];
	readonly players: readonly PlayerListEntry[];
	readonly isAdmin: boolean;
	// what the loading screen says while a join is stuck; undefined when there is
	// nothing to report.
	readonly loadingMessage: string | undefined;
	// a live setProfile rejection, for the profile dialog to surface.
	readonly serverNameError: string | undefined;
	// name edits route through here so the rejection above clears with them.
	readonly onNameChange: (name: string) => void;
	readonly onViewChange: (w: number, h: number) => void;
	// the world can now be drawn, so the join may start (and the grace it is
	// given may start running out). the map load is what knows this, and it is
	// resolved after the session — which supplies the renderer its admin caps and
	// its view reporter — so readiness arrives as a signal rather than as a value
	// the session could have taken up front. idempotent; the page fires it from
	// an effect on the load state.
	readonly onMapDrawable: () => void;
};

export function useOnlineSession({
	gameRef,
	profile,
	setProfile,
	obscenityMode,
	onJoinFailed,
}: OnlineSessionDeps): OnlineSession {
	const [mapReady, setMapReady] = useState(false);
	const [players, roster] = usePlayerRoster();
	const [status, setStatus] = useState<ConnectionStatus>("idle");
	const [connectionError, setConnectionError] = useState<ConnectionError | null>(null);
	const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
	const [isAdmin, setIsAdmin] = useState(false);
	const [serverNameError, setServerNameError] = useState<string | undefined>(undefined);

	// the live profile, for the two things that outlive a render and ask for it
	// on their own schedule: the socket (on every reconnect's hello) and the
	// game (whenever it re-applies the local appearance).
	const getProfile = useLatestGetter(profile);
	// one client for the page's lifetime, built on the first render rather than
	// in an effect: the game takes it as a constructor dependency, so it has to
	// exist before `init` runs — and being a value rather than a nullable ref is
	// what keeps every send free of a "no connection yet" case. the constructor
	// is inert; nothing opens until connect().
	const [net] = useState(
		() => new TabSyncedClient({url: buildWsUrl(), getProfile, getAdminToken: readAdminToken})
	);
	// latest viewport extent (world px) the renderer reported, so a welcome —
	// whose session starts with the maximal default interest area — can be
	// answered with the real extent right away.
	const viewExtentRef = useRef<{w: number; h: number} | null>(null);

	// everyone auto-joins with their saved (or random first-run) identity —
	// there's no first-run picker. a legacy profile with an invalid or empty name
	// gets a fresh random one before the hello can carry it.
	const openConnection = useCallback(() => {
		if (!validateName(getProfile().name).ok) setProfile(randomProfile());
		net.connect();
	}, [net, getProfile, setProfile]);

	const [phase, markJoined] = useJoinPhase({
		mapReady,
		connectionError,
		onJoin: openConnection,
		onFailed: onJoinFailed,
	});
	// read by the live-profile effect, which must see the current phase without
	// re-running (and re-sending) when it changes. the server handlers below are
	// rebuilt every render, so they read `phase` directly.
	const phaseRef = useLatestRef(phase);

	const handleWelcome = (msg: ServerWelcome) => {
		const game = gameRef.current;
		if (!game) return;
		setIsAdmin(msg.isAdmin);
		setServerNameError(undefined);
		const view = viewExtentRef.current;
		if (view) net.send({type: "view", w: view.w, h: view.h});
		setMessages(msg.chatBacklog);
		roster.reset(msg, getProfile());
		game.applyWelcome(msg);
		markJoined();
	};

	const handleJoin = (player: PlayerSnapshot) => {
		const game = gameRef.current;
		if (!game) return;
		game.applyJoin(player);
		// our own join is already the row the welcome placed.
		if (player.connId !== game.selfConnId) roster.add(player);
	};

	const handleLeave = (connId: ConnId) => {
		roster.remove(connId);
		gameRef.current?.applyLeave(connId);
	};

	const handleProfileChanged = (msg: ServerProfileChanged) => {
		roster.setProfile(msg.connId, msg.profile, msg.color);
		gameRef.current?.applyProfileChanged(msg);
		// a change to our own profile means another tab of this identity made the
		// edit; adopt it so this tab's state (and its sprite, via the profile
		// effect) follows. the equality guard stops the setProfile round-trip from
		// ping-ponging with the server.
		if (msg.connId === gameRef.current?.selfConnId) {
			setProfile((prev) => (sameProfile(prev, msg.profile) ? prev : msg.profile));
		}
	};

	// one switch over the server stream, in arrival order. the roster and the
	// backlog are page state; the world side of each message is the game's, so
	// every case hands off to both in the same place.
	const handleServerMessage = (msg: ServerMessage) => {
		switch (msg.type) {
			case "welcome":
				return handleWelcome(msg);
			case "chat": {
				const message = msg.message;
				setMessages((prev) => appendChat(prev, message));
				if (message.kind === "chat")
					gameRef.current?.pushChatBubble(
						message.senderId,
						chatDisplayText(message, obscenityMode)
					);
				return;
			}
			case "join":
				return handleJoin(msg.player);
			case "leave":
				return handleLeave(msg.connId);
			case "profileChanged":
				return handleProfileChanged(msg);
			case "profileRejected":
				// a live setProfile rejection during play surfaces the error on the
				// next profile-dialog open. a pre-join rejection (a stale invalid
				// name) is recovered silently: swap in a fresh random name — keeping
				// the chosen avatar/palette — that WsClient then re-sends on its
				// bounded reconnect.
				if (phase === "joined") setServerNameError(msg.reason);
				else setProfile((prev) => ({...prev, name: randomProfile().name}));
				return;
			case "connectionRejected":
				// consumed by WsClient, which reports it through onConnectionError
				// once the close that follows names the kind.
				return;
		}
	};

	// the handlers above are rebuilt every render and reach the socket through
	// this one mirror. the alternative — passing them to setEvents directly —
	// makes the connection's lifetime a function of their referential identity,
	// so any dependency that later stopped being stable would silently start
	// tearing down and re-opening the socket mid-session. server frames arrive
	// from socket and BroadcastChannel callbacks, always outside React's
	// render/commit window, so the mirror is never read mid-update.
	const events = useLatestRef({
		onStatus: setStatus,
		onConnectionError: setConnectionError,
		onSnapshot: (snap: DecodedSnapshot) => gameRef.current?.applySnapshot(snap),
		onServerMessage: handleServerMessage,
	});

	// points the client at the mirror above and hands it back on teardown. the
	// connection is opened by the join machine once the map loads, not here.
	useEffect(() => {
		net.setEvents({
			onStatus: (status) => events.current.onStatus(status),
			onConnectionError: (error) => events.current.onConnectionError(error),
			onSnapshot: (snap) => events.current.onSnapshot(snap),
			onServerMessage: (msg) => events.current.onServerMessage(msg),
		});
		return () => net.disconnect();
	}, [net, events]);

	// live-apply profile edits, but only after joining. pre-join edits stay
	// local and reach the server via the hello sent on connect.
	useEffect(() => {
		if (phaseRef.current !== "joined") return;
		if (!validateName(profile.name).ok) return;
		net.send({type: "setProfile", profile});
		const game = gameRef.current;
		if (!game) return;
		game.applySelfProfile(profile);
		const selfId = game.selfConnId;
		if (!selfId) return;
		roster.setSelf(selfId, profile);
	}, [profile, net, gameRef, phaseRef, roster]);

	const onNameChange = useCallback(
		(name: string) => {
			setProfile((prev) => ({...prev, name}));
			// editing the name clears any stale server rejection of the previous
			// one — the new name is a fresh attempt, not the rejected value.
			setServerNameError(undefined);
		},
		[setProfile]
	);

	const onViewChange = useCallback(
		(w: number, h: number) => {
			viewExtentRef.current = {w, h};
			net.send({type: "view", w, h});
		},
		[net]
	);

	const onMapDrawable = useCallback(() => setMapReady(true), []);

	return {
		net,
		status,
		connectionError,
		joined: phase === "joined",
		messages,
		players,
		isAdmin,
		loadingMessage: connectionMessage(connectionError, status),
		serverNameError,
		onNameChange,
		onViewChange,
		onMapDrawable,
	};
}
