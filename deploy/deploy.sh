#!/usr/bin/env bash
# Root-owned entrypoint; CI key is limited to this command in authorized_keys.
set -Eeuo pipefail
umask 027
command_text=${SSH_ORIGINAL_COMMAND:-${1:-}}
if [[ ! "$command_text" =~ ^deploy\ ([a-f0-9]{40})$ ]]; then
    echo 'Expected: deploy <40-character commit SHA>' >&2
    exit 2
fi
release_sha=${BASH_REMATCH[1]}
base=/opt/forson
mkdir -p "$base/releases"
# The Nginx worker must traverse the directory to read its access hash file.
chmod 711 "$base"
exec 9>"$base/deploy.lock"
flock -w 900 9
release="$base/releases/$release_sha"
if [[ -e "$release" ]]; then
    if [[ $(readlink -f "$base/current" 2>/dev/null || true) == "$release" ]]; then
        cat > /dev/null
        curl --fail --silent --max-time 10 http://127.0.0.1:15178/api/status | python3 -c 'import json,sys; assert json.load(sys.stdin)["dbReady"]'
        echo "Already deployed $release_sha"
        exit 0
    fi
    # Retry an interrupted/failed upload of this exact immutable commit.
    rm -rf "$release"
fi
mkdir "$release"
trap 'rm -f "$release/upload.tar.gz"' EXIT
cat > "$release/upload.tar.gz"
# The only uploader is the repository workflow; extract within the new release.
tar -xzf "$release/upload.tar.gz" -C "$release" --no-same-owner --no-same-permissions
[[ $(cat "$release/REVISION") == "$release_sha" ]]
rm "$release/upload.tar.gz"
[[ -f "$base/.env" ]]
install -d -o 10001 -g 10001 -m 700 "$base/data"
previous=$(readlink -f "$base/current" 2>/dev/null || true)
compose() {
    local directory=$1
    shift
    RELEASE_SHA=$(cat "$directory/REVISION") docker compose --env-file "$base/.env" -f "$directory/deploy/compose.production.yml" "$@"
}
compose "$release" build
if compose "$release" up -d --wait --wait-timeout 180 && \
   curl --fail --silent --max-time 10 http://127.0.0.1:15178/api/status | python3 -c 'import json,sys; assert json.load(sys.stdin)["dbReady"]'; then
    ln -sfn "$release" "$base/current.next"
    mv -Tf "$base/current.next" "$base/current"
    echo "Deployed $release_sha"
else
    echo 'Release health check failed.' >&2
    if [[ -n "$previous" && -f "$previous/REVISION" ]]; then
        compose "$previous" up -d --no-build --wait --wait-timeout 180
        echo "Restored $(cat "$previous/REVISION")" >&2
    fi
    exit 1
fi
