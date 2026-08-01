#!/usr/bin/env bash
# server-side deploy: syncs the /opt/koholint worktree to the pushed commit and
# (re)starts the prod stack. the post-receive hook in /opt/koholint.git pipes
# this script straight from the pushed commit, so it never runs from a checkout.
#
#   deploy.sh <commit>
set -euo pipefail

BARE=/opt/koholint.git
APP_DIR=/opt/koholint
COMMIT=${1:?usage: deploy.sh <commit>}

compose() {
	docker compose -f "$1/compose.prod.yaml" --project-directory "$1" "${@:2}"
}

# first deploy only: replace the plain github clone (or nothing) with a git
# worktree of the bare repo, carrying over runtime state (.env, sqlite, caddy
# certs). images are built before the old stack goes down, so the outage is
# seconds instead of the whole build.
migrate_to_worktree() {
	local new="$APP_DIR.new"
	if [[ -e $new ]]; then
		git -C "$BARE" worktree remove --force "$new" 2>/dev/null || rm -rf "$new"
	fi
	git -C "$BARE" worktree add --detach "$new" "$COMMIT"
	if [[ -f $APP_DIR/.env ]]; then
		cp -a "$APP_DIR/.env" "$new/.env"
	fi
	compose "$new" build
	if [[ -f $APP_DIR/compose.prod.yaml ]]; then
		compose "$APP_DIR" down
	fi
	if [[ -d $APP_DIR/_data ]]; then
		mv "$APP_DIR/_data" "$new/_data"
	fi
	if [[ -e $APP_DIR ]]; then
		mv "$APP_DIR" "$APP_DIR.pre-worktree"
	fi
	git -C "$BARE" worktree move "$new" "$APP_DIR"
}

git -C "$BARE" worktree prune
if git -C "$BARE" worktree list --porcelain | grep -qx "worktree $APP_DIR"; then
	git -C "$APP_DIR" checkout --detach --force "$COMMIT"
else
	migrate_to_worktree
fi

cd "$APP_DIR"
# the server container runs as uid 1000 and has to own the sqlite dir before
# the first up (compose.prod.yaml).
mkdir -p _data/db
chown -R 1000:1000 _data
compose "$APP_DIR" up -d --build
docker image prune -f >/dev/null
echo "deployed $COMMIT"
