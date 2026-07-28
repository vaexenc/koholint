// the loading screen is a cold-start affordance. once the player is in the
// world, blacking the screen out again — to re-join after a dropped connection,
// or to swap modes — reads as a glitch, and the connection pill already says
// what the link is doing. module scope, so this survives the page swap a mode
// change performs and resets on reload, which is exactly the intended lifetime.
let entered = false;

export function markGameEntered(): void {
	entered = true;
}

export function hasEnteredGame(): boolean {
	return entered;
}
