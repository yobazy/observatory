#!/usr/bin/env bash
# Build a signed, notarized universal DMG, and optionally publish it.
#
#   ./scripts/release.sh --setup     # once: save your notary credentials
#   ./scripts/release.sh             # build, sign, notarize, staple, verify
#   ./scripts/release.sh --publish   # the same, then create the GitHub release
#
# 1. Signs with the "Developer ID Application" certificate in your keychain
#    (or APPLE_SIGNING_IDENTITY when set). An Apple Development certificate
#    won't do: Apple only notarizes Developer ID builds.
# 2. Tauri notarizes and staples the .app; this script then notarizes and
#    staples the DMG around it, so a first launch passes Gatekeeper offline.
# 3. Checks the result the way Gatekeeper will, and writes <App>.dmg at the
#    repo root: the name the README's download link points at.
# 4. Signs the update bundle (<App>.app.tar.gz) with the updater key and
#    writes latest.json beside the DMG: what installed copies check for
#    (tauri.conf.json, plugins.updater). Both go up with the release.
# 5. Writes release notes from the commit subjects since the last version's
#    tag, for the GitHub release and latest.json (the app shows them).
#
# The app-specific password (appleid.apple.com → Sign-In and Security) is
# kept in your login keychain by --setup, never in a file or the shell. The
# updater key is ~/.tauri/<app>.key (UPDATER_KEY to use another), with its
# password in the keychain too. Lose the key and installed copies can't
# update any more: keep a backup of it and its password somewhere safe.
#
# Options:
#   --setup     save your Apple ID and app-specific password to the keychain
#   --publish   after a good build, run `gh release create v<version>`
#   -h, --help  show this
set -euo pipefail

SETUP=0 PUBLISH=0
for arg in "$@"; do
  case "$arg" in
    --setup) SETUP=1 ;;
    --publish) PUBLISH=1 ;;
    -h | --help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

bold=$'\033[1m' green=$'\033[32m' yellow=$'\033[33m' red=$'\033[31m' off=$'\033[0m'
[ -t 1 ] || { bold='' green='' yellow='' red='' off=''; }
step() { printf '\n%s==>%s %s%s%s\n' "$green" "$off" "$bold" "$*" "$off"; }
ok() { printf '  %s✓%s %s\n' "$green" "$off" "$*"; }
note() { printf '  %s!%s %s\n' "$yellow" "$off" "$*"; }
fail() { printf '\n%serror:%s %s\n' "$red" "$off" "$*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || fail "releases are built on macOS"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Name and version from the Tauri config, so a rename doesn't need this edited.
conf() { node -p "require('./src-tauri/tauri.conf.json').$1"; }
NAME="$(conf productName)"
VERSION="$(conf version)"
KEYCHAIN_SERVICE="$(conf identifier).notary"

# ---- credentials ----

if [ "$SETUP" = 1 ]; then
  step "Saving notary credentials"
  read -rp "  Apple ID (email): " apple_id
  read -rsp "  App-specific password: " password; echo
  security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$apple_id" -w "$password" \
    || fail "couldn't write to the keychain"
  ok "saved to your login keychain as \"$KEYCHAIN_SERVICE\""
  exit 0
fi

step "Checking credentials"

identity="${APPLE_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning \
  | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1)}"
[ -n "$identity" ] || fail "no \"Developer ID Application\" certificate in your keychain.
  Create one in Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application."
ok "$identity"

team_id="$(sed -n 's/.*(\([A-Z0-9]\{10\}\))$/\1/p' <<<"$identity")"
[ -n "$team_id" ] || fail "couldn't read the team ID from \"$identity\""

apple_id="$(security find-generic-password -s "$KEYCHAIN_SERVICE" 2>/dev/null \
  | sed -n 's/.*"acct"<blob>="\(.*\)"/\1/p')"
password="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
[ -n "$apple_id" ] && [ -n "$password" ] || fail "no notary credentials saved. Run: $0 --setup"
ok "notarizing as $apple_id (team $team_id)"

UPDATER_KEY="${UPDATER_KEY:-$HOME/.tauri/$(tr '[:upper:]' '[:lower:]' <<<"$NAME").key}"
[ -f "$UPDATER_KEY" ] || fail "no updater key at $UPDATER_KEY. Restore it from your backup; a new key can't
  sign updates that installed copies will accept."
updater_password="$(security find-generic-password -s "$(conf identifier).updater" -w 2>/dev/null || true)"
[ -n "$updater_password" ] || fail "no password for the updater key in the keychain (\"$(conf identifier).updater\")"
ok "updater key $UPDATER_KEY"

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  grep -qx "$target" <<<"$(rustup target list --installed)" \
    || fail "missing Rust target $target. Run: rustup target add $target"
done

if [ "$PUBLISH" = 1 ]; then
  command -v gh >/dev/null || fail "--publish needs the GitHub CLI (brew install gh)"
  gh release view "v$VERSION" >/dev/null 2>&1 \
    && fail "release v$VERSION already exists. Bump the version in tauri.conf.json, Cargo.toml and package.json."
  # The release is tagged at the commit built here, so it must be committed
  # and on GitHub: a DMG built from local edits would match no tag.
  [ -z "$(git status --porcelain)" ] || fail "commit your changes first: the release is tagged at HEAD"
  commit="$(git rev-parse HEAD)"
  git fetch --quiet origin
  [ -n "$(git branch -r --contains "$commit")" ] || fail "push $(git rev-parse --abbrev-ref HEAD) first: the release is tagged at HEAD"
  ok "tagging v$VERSION at $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
fi

# ---- build: Tauri signs, notarizes and staples the .app ----

step "Building $NAME $VERSION (universal)"
export APPLE_SIGNING_IDENTITY="$identity" APPLE_ID="$apple_id" APPLE_PASSWORD="$password" APPLE_TEAM_ID="$team_id"
TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY")"
export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$updater_password"
# The config's "-" (ad-hoc) keeps local builds working without a certificate;
# override it here so the release is signed with the Developer ID.
# Apple's timestamp server drops a request now and then, and Tauri gives up
# on the first; so try again then (the second build is mostly cached).
log="$(mktemp)"
for attempt in 1 2 3; do
  if npm run tauri build -- --target universal-apple-darwin --bundles app,dmg \
    --config "{\"bundle\":{\"macOS\":{\"signingIdentity\":\"$identity\"}}}" 2>&1 | tee "$log"; then
    break
  fi
  grep -q "A timestamp was expected" "$log" && [ "$attempt" -lt 3 ] || fail "the build failed"
  note "Apple's timestamp server didn't answer; trying again"
done
rm -f "$log"

bundle="src-tauri/target/universal-apple-darwin/release/bundle"
app="$bundle/macos/$NAME.app"
built_dmg="$bundle/dmg/${NAME}_${VERSION}_universal.dmg"
update_tgz="$bundle/macos/$NAME.app.tar.gz"
[ -d "$app" ] && [ -f "$built_dmg" ] || fail "the build didn't produce $app and $built_dmg"
[ -f "$update_tgz" ] && [ -f "$update_tgz.sig" ] || fail "the build didn't produce the signed update bundle $update_tgz"

# ---- the DMG: notarize and staple it too ----

step "Notarizing the DMG"
dmg="$NAME.dmg"
cp "$built_dmg" "$dmg"
codesign --force --sign "$identity" --timestamp "$dmg"
result="$(xcrun notarytool submit "$dmg" --apple-id "$apple_id" --password "$password" --team-id "$team_id" --wait)" || true
printf '%s\n' "$result"
grep -q "status: Accepted" <<<"$result" || fail "notarization wasn't accepted. See why with:
  xcrun notarytool log <submission id above> --apple-id $apple_id --team-id $team_id"
xcrun stapler staple "$dmg"

# ---- verify as Gatekeeper would ----

step "Verifying"
codesign --verify --deep --strict "$app" || fail "the app's signature doesn't verify"
grep -q "flags=.*runtime" <<<"$(codesign -dv "$app" 2>&1)" || fail "the app isn't signed with the hardened runtime"
spctl -a -t exec "$app" 2>/dev/null || fail "Gatekeeper rejects the app: spctl -a -vvv -t exec \"$app\""
ok "app: signed, hardened, notarized"
xcrun stapler validate -q "$dmg" || fail "the DMG has no stapled ticket"
spctl -a -t open --context context:primary-signature "$dmg" 2>/dev/null \
  || fail "Gatekeeper rejects the DMG: spctl -a -vvv -t open --context context:primary-signature $dmg"
ok "$dmg: notarized and stapled"
# The update bundle is what installed copies unpack over themselves, so it
# has to hold the notarized app too, not one from before the staple.
unpacked="$(mktemp -d)"
tar -xzf "$update_tgz" -C "$unpacked"
xcrun stapler validate -q "$unpacked/$NAME.app" || fail "the app in $update_tgz isn't the notarized one"
rm -rf "$unpacked"
ok "$(basename "$update_tgz"): notarized app, signed for the updater"

# ---- release notes: what changed since the last version ----

# The commit subjects since the previous release's tag, one bullet each;
# "Version x.y.z" commits say nothing a reader needs. The same text goes on
# the GitHub release and into latest.json, where the app shows it.
git fetch --quiet --tags origin 2>/dev/null || true
previous="$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || true)"
notes_file="$(mktemp)"
git log --no-merges --format='- %s' ${previous:+"$previous..HEAD"} \
  | grep -vE '^- (Version|Release) v?[0-9]+\.[0-9]+' >"$notes_file" || true
[ -s "$notes_file" ] || echo "- Fixes and improvements" >"$notes_file"
ok "release notes: $(wc -l <"$notes_file" | tr -d ' ') changes since ${previous:-the first commit}"

# ---- latest.json: what installed copies check ----

# Assets live at releases/download/v<version>/ in the repo the updater's
# endpoint names; a universal app serves both architectures.
releases="$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.endpoints[0].replace(/\/latest\/download\/.*$/, '')")"
NOTES="$(cat "$notes_file")" VERSION="$VERSION" URL="$releases/download/v$VERSION/$(basename "$update_tgz")" SIG="$(cat "$update_tgz.sig")" node -e '
  const { NOTES, VERSION, URL, SIG } = process.env;
  const target = { signature: SIG, url: URL };
  const manifest = {
    version: VERSION,
    notes: NOTES,
    pub_date: new Date().toISOString(),
    platforms: { "darwin-aarch64": target, "darwin-x86_64": target },
  };
  require("fs").writeFileSync("latest.json", JSON.stringify(manifest, null, 2) + "\n");
'
ok "latest.json: $VERSION at $releases/download/v$VERSION/"

# ---- publish ----

if [ "$PUBLISH" = 1 ]; then
  step "Publishing v$VERSION"
  gh release create "v$VERSION" "$dmg" "$update_tgz" latest.json --target "$commit" --title "$NAME $VERSION" --notes-file "$notes_file"
  ok "released v$VERSION"
else
  printf '\nRelease notes:\n%s\n' "$(cat "$notes_file")"
  printf '\n%s is ready. Publish it with: %s --publish\n' "$dmg" "$0"
fi
rm -f "$notes_file"
