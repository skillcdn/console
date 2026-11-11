#!/usr/bin/env bash
# Makes the bundle an installation without internet is made from (README.md, "An installation
# without internet"): run where there is internet, it puts the images, the files an installation
# runs and the command for the agents' machines into one directory, with the digest of every
# file. Carry the directory over, and run its install.sh with --offline.
#
# Usage: bundle.sh [options] [directory]
#
#   --image REF     the console image to take along; unless said, the image of the release this
#                   checkout is of. An image this host built is taken as it is, with --no-pull
#   --platform P    the platform of the installation, linux/amd64 or linux/arm64; unless said,
#                   this machine's
#   --no-pull       take the images this host has, and fetch none
#   --no-command    leave out the command for the agents' machines
#
# The directory is ./skillcdn-console-bundle unless named. Nothing of an installation's own goes
# into a bundle: no settings, no secret, no pack.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
registry_image=ghcr.io/skillcdn/console
package=@skillcdn/console

image=""
platform=""
pull=true
with_command=true
out=""

fail() {
  echo "bundle: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --image) [ $# -ge 2 ] || fail "--image takes an image reference"; image=$2; shift 2 ;;
    --platform) [ $# -ge 2 ] || fail "--platform takes a platform"; platform=$2; shift 2 ;;
    --no-pull) pull=false; shift ;;
    --no-command) with_command=false; shift ;;
    -h | --help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) fail "unknown option: $1 (see --help)" ;;
    *) [ -z "$out" ] || fail "one directory, not two: $1"; out=$1; shift ;;
  esac
done

# The digests of files, by whichever of the two tools the host has.
digests() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@"
  else
    fail "neither sha256sum nor shasum is installed"
  fi
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
digests /dev/null >/dev/null
[ -f "$here/../packages/console/package.json" ] || fail "run this from the repository: the release is read from it"
if $with_command; then
  command -v npm >/dev/null 2>&1 || fail "npm is not installed, and it fetches the command for the agents' machines; leave the command out with --no-command"
fi

release=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$here/../packages/console/package.json" | head -n 1)
[ -n "$release" ] || fail "the release of this checkout could not be read"
# The database's image is the one the installation's own file names.
database_image=$(sed -n 's/^    image: \(postgres:[^ ]*\)$/\1/p' "$here/compose.yaml" | head -n 1)
[ -n "$database_image" ] || fail "compose.yaml names no image of the database"
image=${image:-$registry_image:$release}
out=${out:-skillcdn-console-bundle}
[ ! -e "$out" ] || fail "$out is there already; name another directory, or remove it"

mkdir -p "$out/images"
out=$(cd "$out" && pwd)

# These files, as the installation runs them. The settings file is the installation's own.
for file in compose.yaml install.sh README.md; do
  cp "$here/$file" "$out/$file"
done
cp "$here/../.env.example" "$out/.env.example"
cp "$here/../LICENSE.md" "$out/"
chmod +x "$out/install.sh"

images="$image $database_image"
for ref in $images; do
  if $pull; then
    echo "pulling $ref"
    docker pull ${platform:+--platform "$platform"} "$ref" >/dev/null || fail "no image $ref could be pulled; name the console's with --image, or take what this host has with --no-pull"
  else
    docker image inspect "$ref" >/dev/null 2>&1 || fail "this host has no image $ref, and --no-pull fetches none"
  fi
done

echo "saving the images"
# shellcheck disable=SC2086
docker save $images | gzip >"$out/images/images.tar.gz"

# What was taken along, by the digest a registry knows it under where it has one.
{
  echo "version=$release"
  echo "image=$image"
  for ref in $images; do
    echo "# $ref $(docker image inspect --format '{{.Id}}{{range .RepoDigests}} {{.}}{{end}}' "$ref")"
  done
} >"$out/VERSION"

if $with_command; then
  # The command with everything it depends on, as npm keeps what it fetched: a machine inside
  # installs from this cache alone. Installed here into a directory that is thrown away, with no
  # script of any package run.
  echo "fetching the command, $package@$release, with what it depends on"
  scratch=$(mktemp -d)
  npm install --global --prefix "$scratch" --cache "$out/command" --ignore-scripts --no-audit --no-fund --loglevel=error "$package@$release" >/dev/null || {
    rm -rf "$scratch"
    fail "npm could not fetch $package@$release: check out a release that is published, or leave the command out with --no-command"
  }
  rm -rf "$scratch"
  # What npm notes of this machine beside what it fetched is none of the bundle's.
  find "$out/command" -mindepth 1 -maxdepth 1 ! -name _cacache -exec rm -rf {} +
  echo "command=$package@$release" >>"$out/VERSION"
fi

echo "writing the digests"
(cd "$out" && find . -type f ! -name SHA256SUMS | LC_ALL=C sort | while IFS= read -r file; do digests "$file"; done >SHA256SUMS)

echo
echo "The bundle is in $out ($(du -sh "$out" | cut -f1))."
echo "Carry the directory to the installation and run: ./install.sh --offline"
if $with_command; then
  echo "On each agent's machine, with Node.js 24 there: npm install -g --offline --cache <the bundle>/command $package@$release"
fi
