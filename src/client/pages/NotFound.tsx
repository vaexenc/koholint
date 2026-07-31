// the single answer to anything this app won't serve: an unknown path, or the
// admin panel without a valid cookie. both render exactly this, so a visitor
// without the token can't tell the panel apart from a typo.
export function NotFound() {
	return (
		<div className="grid min-h-dvh place-items-center bg-neutral-950 text-sm text-neutral-100">
			not found
		</div>
	);
}
