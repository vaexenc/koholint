#!/usr/bin/env bash
# one-time vps setup for push-to-deploy. run from your machine:
#
#   ssh root@31.70.112.147 'bash -s' < scripts/setup-deploy.sh
#
# then add the remote and deploy with a push:
#
#   git remote add deploy root@31.70.112.147:/opt/koholint.git
#   git push deploy main
#
# safe to re-run: it only (re)creates the bare repo and hook.
set -euo pipefail

BARE=/opt/koholint.git

[[ $EUID -eq 0 ]] || {
	echo "run as root" >&2
	exit 1
}

[[ -d $BARE ]] || git init --bare --initial-branch=main "$BARE"

# the hook runs scripts/deploy.sh from the pushed commit itself, so deploy
# logic stays versioned in the repo and the hook never needs updating.
cat >"$BARE/hooks/post-receive" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# the receiving push exports GIT_DIR; git calls below must resolve on their own.
unset GIT_DIR GIT_WORK_TREE
BARE=/opt/koholint.git
commit=""
while read -r _old new ref; do
	if [[ $ref == refs/heads/main && ! $new =~ ^0+$ ]]; then
		commit=$new
	fi
done
[[ -n $commit ]] || exit 0
git --git-dir="$BARE" show "$commit:scripts/deploy.sh" | bash -s -- "$commit"
EOF
chmod +x "$BARE/hooks/post-receive"

echo "deploy target ready: push main to $BARE"
