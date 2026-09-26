#!/usr/bin/env bash
# Ship the server to the VPS and (re)start the stack.
#
#   bash scripts/deploy-server.sh root@YOUR.SERVER.IP bela.example.com
#
# Copies exactly what the container needs (no git required on the box),
# then builds and restarts remotely. Roughly a minute end to end; running
# matches survive nothing — deploy between games.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SERVER=${1:?usage: deploy-server.sh user@host domain}
DOMAIN=${2:?usage: deploy-server.sh user@host domain}

# Never ship a web bundle that asks players' browsers to dial their own machine.
# This lives here as well as in build-web.sh because deploy-server.sh ships
# whatever is already sitting in deploy/site, and following the deploy docs
# alone would happily re-send a stale pre-fix bundle.
IDX=deploy/site/igra/index.html
if [ -f "$IDX" ]; then
  SERVED=$(grep -o 'index-[0-9a-f]*\.js' "$IDX" | head -1 || true)
  if [ -n "$SERVED" ] && grep -q 'ws://localhost:2567' "deploy/site/igra/_expo/static/js/web/$SERVED"; then
    echo "!! $SERVED points at ws://localhost:2567 -- rebuild with scripts/build-web.sh"
    exit 1
  fi
  # Nor one whose "report a player" goes to the placeholder address.
  if [ -n "$SERVED" ] && grep -q 'REPORT-ADDRESS-NOT-SET' "deploy/site/igra/_expo/static/js/web/$SERVED"; then
    echo "!! $SERVED carries the placeholder report address (apps/mobile/src/report.ts) -- set it and rebuild"
    exit 1
  fi
fi

echo "== packing"
TAR=$(mktemp -t bela-deploy-XXXX.tgz 2>/dev/null || echo "${TMPDIR:-/tmp}/bela-deploy-$$.tgz")
tar czf "$TAR" \
  package.json package-lock.json tsconfig.json .dockerignore \
  packages/shared-types packages/engine packages/bots packages/table \
  apps/server \
  deploy

echo "== uploading to $SERVER"
scp -q "$TAR" "$SERVER:/opt/bela/deploy.tgz"
rm -f "$TAR"

# The image is tagged by the commit it was built from ("-dirty" when the
# working tree differs), /health reports the same, and the previous image
# stays on the box: rollback-server.sh puts it back in about two minutes.
SHA=$(git rev-parse --short HEAD)
# Untracked files count too (git diff would not see a new file), and so do the
# root files the tarball ships; ignored files (node_modules, deploy/site) do not.
[ -z "$(git status --porcelain -- apps/server packages deploy package.json package-lock.json tsconfig.json .dockerignore 2>/dev/null)" ] || SHA="$SHA-dirty"
echo "== building and starting on the box (domain: $DOMAIN, build $SHA)"
ssh "$SERVER" "bash -s" <<REMOTE
set -euo pipefail
cd /opt/bela
# The box's config.json (the kill switch) is what an operator edits in an
# emergency; a deploy must not put the repo's copy back over it. The repo's
# file seeds a box that has none.
EX=
if [ -f deploy/site/config.json ]; then EX=--exclude=deploy/site/config.json; fi
tar xzf deploy.tgz \$EX && rm deploy.tgz
cd deploy
export DOMAIN=$DOMAIN
export BELA_TAG=$SHA
# The build that was running until now is the one a rollback goes back to -
# by what RAN, not by image age: after a rollback and a fix-forward the newest
# two images would be the fix and the bad build, and the known-good one gone.
PREV=\$(grep '^BELA_TAG=' .env 2>/dev/null | cut -d= -f2 || true)
[ "\$PREV" = "$SHA" ] && PREV=\$(grep '^BELA_PREV=' .env 2>/dev/null | cut -d= -f2 || true)
# Leave DOMAIN and the tags on the box too. Without them a plain "docker compose
# ps" or "logs" in this directory fails on the unset variable -- a trap for
# anyone debugging here later, and a hazard if they reach for "up -d" with an
# empty domain or the wrong image.
printf 'DOMAIN=%s\nBELA_TAG=%s\nBELA_PREV=%s\n' "$DOMAIN" "$SHA" "\$PREV" > .env
docker compose build bela
docker compose up -d
# Keep this build and the one that ran before it for a rollback; anything else goes.
docker images bela-server --format '{{.Tag}}' | { grep -vx -e "$SHA" -e "\${PREV:-none}" || true; } | xargs -r -I{} docker rmi bela-server:{} >/dev/null 2>&1 || true
echo "== images on the box: \$(docker images bela-server --format '{{.Tag}}' | tr '\n' ' ')"
# The Caddyfile is bind-mounted as a single FILE, and the upload above replaces
# it rather than writing in place -- so the running container goes on holding
# the old inode and quietly serving the previous config. Nothing reports this:
# compose sees no change, and "caddy reload" reloads the stale file it can see.
# Recreate caddy only when what it has differs from what we just shipped, so an
# unchanged deploy does not drop live websocket connections for nothing.
# </dev/null matters: this whole script is being fed to the remote bash on stdin
# (ssh ... "bash -s" <<REMOTE), and compose attaches the caller's stdin to the
# exec. Without it the command eats the next lines of the script, which bash has
# already stopped being able to read -- silently, and with a zero exit code.
if ! docker compose exec -T caddy cat /etc/caddy/Caddyfile </dev/null 2>/dev/null | cmp -s - Caddyfile; then
  echo "== Caddyfile changed; recreating caddy to pick it up"
  docker compose up -d --force-recreate caddy
fi
docker image prune -f >/dev/null
# Every deploy adds a content-hashed bundle and nothing ever removed the old
# ones: they had grown to 24MB of a 27MB site directory. Keep the newest three,
# which still covers a player who loaded the page moments before the deploy and
# whose script request lands just after it.
WEB=/opt/bela/deploy/site/igra/_expo/static/js/web
KEEP=\$(grep -o 'index-[0-9a-f]*\.js' /opt/bela/deploy/site/igra/index.html 2>/dev/null | head -1 || true)
if [ -d "\$WEB" ] && [ -n "\$KEEP" ]; then
  # Keep the bundle index.html actually names, whatever its timestamp, plus the
  # two next newest. Ranking purely by mtime could delete the very file just
  # shipped, and a bare "ls" of an empty match aborts the deploy under pipefail.
  # Every stage needs its own guard: grep exits 1 when it selects NOTHING, and
  # under pipefail that sinks the whole deploy. That is the fresh-box case
  # exactly -- one bundle on disk and it is the one being served -- so the first
  # deploy to a new box reported failure while having actually worked.
  ( ls -1t "\$WEB"/index-*.js 2>/dev/null || true ) | { grep -vF "\$KEEP" || true; } | tail -n +3 | xargs -r rm -f
  echo "== web bundles on disk: \$( ( ls -1 "\$WEB"/index-*.js 2>/dev/null || true ) | wc -l ), serving \$KEEP"
fi
docker compose ps
REMOTE

echo "== waiting for TLS + health to report $SHA"
OK=
for i in $(seq 1 45); do
  H=$(curl -fsS "https://$DOMAIN/health" 2>/dev/null || true)
  case "$H" in *"\"sha\":\"$SHA\""*) OK=1; break;; esac
  sleep 2
done
echo "$H"
[ -n "$OK" ] || { echo "!! /health never reported $SHA - what is live is not what was just built"; exit 1; }
echo "== LIVE at https://$DOMAIN"
echo "== verify the transport promise:  SERVER_URL=wss://$DOMAIN npm run smoke"
