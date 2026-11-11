#!/usr/bin/env bash
# Makes the smallest install on this host (README.md, "Installing with the script"): checks what
# it needs, writes the settings file with a database password of its own making when there is
# none, and brings compose.yaml up. Run again, it keeps every setting that is there and brings
# the console up on what it is told; nothing it writes is ever printed.
#
# Usage: install.sh [options]
#
#   --image REF    the console image; unless said, the image of the release these files are of
#   --build        build the image from this checkout instead, as skillcdn-console
#   --url ORIGIN   the origin people and agents use, such as https://console.example.com; it is
#                  what signing in is registered with, and is kept once a provider is set
#   --port PORT    the port of this host the console listens on (11199 unless said)
#   --bind ADDRESS the address of this host it listens on: 127.0.0.1 unless said, 0.0.0.0 where
#                  the proxy in front is on another machine
#   --packs DIR    the organization's packs: DIR/<name>, each a directory in the SkillCDN
#                  Format, is served at /local/org/<name>
#   --offline      reach nothing outside this host: load the images kept beside this script,
#                  check every file against the bundle's digests, and never pull
#   --no-start     write the settings and stop
#
# It reads no secret from its arguments and takes none. The database password is made here, and
# so is the secret signing in is sealed with, once the settings name an identity provider: its
# client id and secret are a person's to register and to write into .env beside this script,
# which only its owner may read.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
registry_image=ghcr.io/skillcdn/console

image=""
build=false
url=""
port=""
bind=""
packs=""
offline=false
start=true

fail() {
  echo "install: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --image) [ $# -ge 2 ] || fail "--image takes an image reference"; image=$2; shift 2 ;;
    --build) build=true; shift ;;
    --url) [ $# -ge 2 ] || fail "--url takes an origin"; url=$2; shift 2 ;;
    --port) [ $# -ge 2 ] || fail "--port takes a port"; port=$2; shift 2 ;;
    --bind) [ $# -ge 2 ] || fail "--bind takes an address"; bind=$2; shift 2 ;;
    --packs) [ $# -ge 2 ] || fail "--packs takes a directory"; packs=$2; shift 2 ;;
    --offline) offline=true; shift ;;
    --no-start) start=false; shift ;;
    -h | --help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown option: $1 (see --help)" ;;
  esac
done

case "$url" in
  "" | http://* | https://*) ;;
  *) fail "--url is an origin with its scheme, such as https://console.example.com" ;;
esac
url=${url%/}
case "$port" in
  "") ;;
  *[!0-9]*) fail "--port is a number" ;;
esac
case "$bind" in
  "") ;;
  *[!0-9a-fA-F.:]*) fail "--bind is an address of this host, such as 127.0.0.1 or 0.0.0.0" ;;
esac
if $build && [ -n "$image" ]; then
  fail "--build and --image name two different images"
fi
if $build && $offline; then
  fail "--build fetches what the image is built from; an offline installation takes its image from the bundle"
fi

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "the compose plugin of docker is not installed (docker compose version)"
docker info >/dev/null 2>&1 || fail "the docker daemon does not answer; start it, or run this as a user who may use it"

# A value made of 32 random bytes, in hex: long enough for every secret the console reads.
secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# The digests of files, by whichever of the two tools the host has.
digests() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@"
  else
    fail "neither sha256sum nor shasum is installed: the bundle's files cannot be checked"
  fi
}

env_file=$here/.env

# The value of a setting in the file, or nothing. A line that is commented out sets nothing.
setting() {
  [ -f "$env_file" ] || return 0
  sed -n "s/^$1=//p" "$env_file" | tail -n 1
}

# Writes a setting, in place of the line that set it before.
set_setting() {
  local key=$1 value=$2 rest
  rest=$(mktemp)
  if [ -f "$env_file" ]; then
    grep -v "^$key=" "$env_file" >"$rest" || true
  fi
  printf '%s=%s\n' "$key" "$value" >>"$rest"
  cat "$rest" >"$env_file"
  rm -f "$rest"
}

# The release these files are of: named by the bundle, else read from the checkout.
release=""
if [ -f "$here/VERSION" ]; then
  release=$(sed -n 's/^version=//p' "$here/VERSION")
  [ -n "$image" ] || image=$(sed -n 's/^image=//p' "$here/VERSION")
elif [ -f "$here/../packages/console/package.json" ]; then
  release=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$here/../packages/console/package.json" | head -n 1)
fi

if $offline; then
  if [ -f "$here/SHA256SUMS" ]; then
    echo "checking the files of the bundle against its digests"
    (cd "$here" && digests -c SHA256SUMS | { grep -v ': OK$' || true; }) || fail "a file of the bundle is not what the bundle was made with; nothing was installed"
  else
    echo "no SHA256SUMS beside this script: the files are taken as they are" >&2
  fi
  for archive in "$here"/images/*.tar "$here"/images/*.tar.gz; do
    [ -f "$archive" ] || continue
    echo "loading $(basename "$archive")"
    docker load -i "$archive" >/dev/null
  done
fi

if $build; then
  [ -f "$here/Dockerfile" ] && [ -f "$here/../package.json" ] || fail "--build needs the repository these files came from"
  image=skillcdn-console
  echo "building $image"
  docker build -f "$here/Dockerfile" -t "$image" "$here/.."
fi
if [ -z "$image" ]; then
  image=$(setting CONSOLE_IMAGE)
fi
if [ -z "$image" ]; then
  image=$registry_image:${release:-latest}
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
  if $offline; then
    fail "this host has no image $image, and an offline installation pulls none; the bundle's images/ holds what it was made with"
  fi
  echo "pulling $image"
  docker pull "$image" >/dev/null || fail "no image $image could be pulled; name one with --image, or build it from the repository with --build"
fi

# The settings file: made once, readable by its owner alone, and never replaced.
umask 077
if [ ! -f "$env_file" ]; then
  echo "writing $env_file"
  cat >"$env_file" <<'EOF'
# The settings of this installation (README.md, "Environment contract"). install.sh wrote it and
# keeps what is here; .env.example lists every variable the console reads.
#
# Signing in (README.md, "Signing in"): register the console at the identity provider your
# people use, take the mark off the front of one provider's two lines and of ADMINS, fill them
# in, and run install.sh again with --url. A git host of your own is named by GITHUB_WEB_URL and
# GITHUB_API_URL, as .env.example says.
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# ADMINS=
EOF
  set_setting POSTGRES_PASSWORD "$(secret)"
else
  echo "keeping the settings of $env_file"
  [ -n "$(setting POSTGRES_PASSWORD)" ] || fail "$env_file sets no POSTGRES_PASSWORD; set one, or move the file away to have one made"
fi
chmod 600 "$env_file" 2>/dev/null || true
set_setting CONSOLE_IMAGE "$image"
[ -z "$port" ] || set_setting CONSOLE_PORT "$port"
[ -z "$bind" ] || set_setting CONSOLE_BIND "$bind"
if [ -n "$packs" ]; then
  [ -d "$packs" ] || fail "--packs names no directory: $packs"
  set_setting PACKS_PATH "$(cd "$packs" && pwd)"
fi

# Signing in is whole or not there: the console does not start on half of it. A provider is a
# person's to register; the origin and the secret follow it here.
provider=false
if [ -n "$(setting GITHUB_CLIENT_ID)" ] && [ -n "$(setting GITHUB_CLIENT_SECRET)$(setting GITHUB_CLIENT_SECRET_FILE)" ]; then
  provider=true
fi
if [ -n "$(setting GOOGLE_CLIENT_ID)" ] && [ -n "$(setting GOOGLE_CLIENT_SECRET)$(setting GOOGLE_CLIENT_SECRET_FILE)" ]; then
  provider=true
fi
if $provider; then
  [ -z "$url" ] || set_setting PUBLIC_URL "$url"
  [ -n "$(setting PUBLIC_URL)" ] || fail "$env_file names an identity provider, and signing in needs the origin people use: run this again with --url"
  [ -n "$(setting AUTH_SECRET)$(setting AUTH_SECRET_FILE)" ] || set_setting AUTH_SECRET "$(secret)"
elif [ -n "$(setting PUBLIC_URL)$(setting AUTH_SECRET)$(setting AUTH_SECRET_FILE)$(setting ADMINS)" ]; then
  fail "$env_file sets PUBLIC_URL, AUTH_SECRET or ADMINS and no identity provider, and the console does not start on half of signing in: set a provider's client id and secret there, or take those lines out"
fi

if ! $start; then
  echo "settings written; bring the console up with: (cd $here && docker compose up -d)"
  exit 0
fi

cd "$here"
if $offline; then
  docker compose up -d --pull never
else
  docker compose up -d
fi

listening=$(setting CONSOLE_PORT)
listening=${listening:-11199}
echo "waiting for the console to be ready"
ready=false
for _ in $(seq 1 60); do
  id=$(docker compose ps -q api 2>/dev/null || true)
  if [ -n "$id" ] && [ "$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null)" = healthy ]; then
    ready=true
    break
  fi
  sleep 2
done
$ready || fail "the console did not become ready; see: (cd $here && docker compose logs migrate api)"

echo
echo "SkillCDN Console ${release:+$release }is running at http://127.0.0.1:$listening (image $image)."
if $provider; then
  echo "People sign in at $(setting PUBLIC_URL). The first administrators are the logins ADMINS names in $env_file."
  [ -n "$(setting ADMINS)" ] || echo "ADMINS names nobody there yet: nobody is let in until it does."
else
  origin=${url:-https://console.example.com}
  echo "Nobody can sign in yet. Register the console at the identity provider your people use, with"
  echo "the callback $origin/auth/gh/callback at a git host or $origin/auth/google/callback at Google;"
  echo "write its client id and secret, and ADMINS, into $env_file; then run:"
  echo "  $0 --url $origin"
fi
packs_path=$(setting PACKS_PATH)
owner=$(setting PACKS_OWNER)
echo "Packs: a directory <name> under ${packs_path:-$here/packs} is served at /local/${owner:-org}/<name>; the console's own skills are at /local/skillcdn/console."
echo "Settings and secrets: $env_file."
echo "Put TLS in front before anything but this host reaches it (README.md, \"Behind a reverse proxy\")."
