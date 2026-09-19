# Protected character delivery

The Mac app uses a private Cloudflare R2 Standard bucket and a narrow Worker
endpoint. The v0.2.19 installer includes encrypted Sarah with her appearance
controls and motions, so first launch needs only a brief online unlock. Sarah
then works offline. Other characters and larger texture tiers download from R2.

The current signed catalogue is `music-pelvis-20260917`. Sarah uses
`sarah-wardrobe-v10`; the other four model/texture revisions are unchanged.
All five motion overlays use `music-pelvis-20260917`. Sarah's bundled encrypted
base is 588,233,232 bytes and her matching overlay is 60,108,916 bytes.
Earlier immutable parts remain in the gateway allowlist for existing releases.

The installer and its release record are served by the same Worker under the
public `releases/` prefix (see "Publishing an installer" below); the source
repository is private. Purchased character files are not source-code
dependencies and must not be uploaded anywhere as GLB, Blender, texture ZIP,
or plaintext avatar folders.

## Protection

- Each `.gla` archive uses AES-256-GCM with independently authenticated 1 MiB
  chunks and random nonces. The authenticated header includes filenames,
  offsets, character, tier and asset revision.
- The Ed25519-signed catalogue supplies sizes and SHA-256 checksums. Downloads
  use 64 MiB ciphertext parts, verify each part and the complete archive, and
  replace an installed archive only after verification. Cancellation or
  corruption leaves the previous revision usable.
- Archives remain encrypted in Application Support. The renderer receives
  only requested resources over a session-authenticated local server, with
  `no-store` caching. No model folder is unpacked to disk.
- Content keys live in a Cloudflare secret. The app requests them wrapped to a
  fresh RSA-OAEP key and stores them using macOS `safeStorage`. A subsequent
  offline launch uses that protected local store. Content keys and the signing
  private key are excluded from the DMG and git.
- The application download credential limits access to the intended protocol;
  it is not a purchaser identity or unbreakable DRM. A determined person who
  controls their computer can inspect decrypted geometry or modify the client.
  These measures deter casual extraction; they cannot guarantee non-extraction
  or replace the asset creator's license requirements.

## Storage and traffic boundaries

Use a **dedicated Workers Free account**. Do not downgrade an account running
other paid services. Workers Free has a hard 100,000-request daily limit; this
Worker does at most one R2 read for each accepted file GET. Catalogue, key
wrapping, rejected requests and HEAD checks on encrypted parts perform no R2
operations. This bounds public downloads to at most 3.1 million R2 reads in a
31-day month, below R2 Standard's 10 million monthly Class B allowance.
Requests stop when Workers Free reaches its limit; they do not automatically
upgrade the account.

The unauthenticated `releases/` routes share that daily request budget: anyone
can request them, so a flood of release-page hits would exhaust the Worker's
daily limit and pause avatar downloads for the rest of the day. That is the
cost of a public installer link on this account; if it becomes a problem, move
`releases/` to a second Workers Free account or a static host. Each accepted
`releases/` GET or HEAD is still at most one R2 read; malformed names, extra
query strings and ranged requests are rejected before storage.

The public gateway and R2 can live in separate accounts. In this deployment,
R2 stays in the existing storage account and a new Workers Free account hosts
the gateway. The gateway uses a bucket-scoped **Object Read only** S3 credential
configured as a Worker secret; the maintainer retains its private local setup
copy. It is never packaged in the app or disclosed to download clients. The gateway signs a single private S3 GET and streams it;
it never returns credentials or presigned URLs to clients. Redirects and
automatic storage retries are disabled to preserve the one-read bound.

The uploader sums objects across the account's buckets and refuses a planned
peak above **10,000,000,000 bytes**, including retained releases and any
installers under `releases/`. It accepts only the signed catalogue and
encrypted download parts, uses Standard storage, and verifies every remote
SHA-256 checksum. It never uploads the duplicate complete archives, private
build files or raw sources. Unknown inventory, pagination or storage classes
fail closed. The installer publisher applies the same cap; with ~8 GB of
encrypted parts only one ~1 GB installer fits, so each publish normally
retires the previous one (`--retire-previous`).

For maintainer verification, an existing bucket-scoped Object Read only S3
credential is used only when its account and bucket match exactly; otherwise
a missing credential falls back to the Cloudflare API. Interrupted downloads
retry with a fresh SHA-256 calculation, while size or hash mismatches stop the
upload. Run `node qa/upload-r2.cjs` for the local transport regression. These
maintainer retries do not change the public Worker’s single-read behavior.

This is an enforced upload-workflow cap, not a native R2 account quota. Keep
other writers and uploads away from the avatar bucket and reserve the remaining
R2 free allowance in its storage account. Manual
uploads or changing to Workers Paid can bypass these cost assumptions. Keep
`r2.dev` and public custom bucket domains disabled. The Worker needs only GET
(plus the `authorize` POST); do not add listing, upload, transcoding, AI or
other billable routes. The public `releases/` routes are the one intentional
exception and are read-only.

Current inventory includes the new packages and retained previous release parts:
**7,999,497,171 bytes** across 130 objects, including the signed catalogue.
Whole local `.gla` files are not uploaded as additional objects.

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Maintainer build and migration

1. Put licensed, verified package directories at `build/characters/<slug>` for
   `tia`, `sarah`, `iselda`, `ming-mei` and `seraphim`. These stay outside git.
2. Run `npm run build-protected-assets`. It preserves the private release key
   file, builds the three tiers, round-trips every file against its source,
   signs the catalogue, links encrypted Sarah into `build/protected/starter/sarah`, and
   emits `build/protected/inventory.json`. Back up
   `private-build.json` privately; losing it loses future signing continuity.
   Never upload that file or `assets-runtime.json` to the asset bucket.
3. Confirm Workers **Free** for the gateway account. Activate R2 in the storage
   account (which may be separate). Create
   the private Standard bucket `gpt-live-avatar-protected`. Do not enable its
   public development URL or a public custom domain.
4. Run `node tools/cloud/upload-r2.cjs STORAGE_ACCOUNT_ID gpt-live-avatar-protected` for a
   dry run. Add `--apply` only for the approved account. It uses the active
   Wrangler login, or `CLOUDFLARE_API_TOKEN`, without printing the credential.
   After verification, run `node tools/cloud/prepare-worker.cjs FREE_GATEWAY_ACCOUNT_ID`.
   For separate accounts, privately save `build/protected/r2-reader-secret.json`
   with `account`, `bucket`, `permission: "object-read-only"`, `accessKeyId` and
   `secretAccessKey`, using a token scoped only to the avatar bucket. Keep this
   file outside git, installer resources and uploads, with file mode 600.
5. Run `node tools/cloud/deploy.cjs --workers-free-confirmed`. It requires a
   verified R2 inventory, deploys the narrow gateway, installs its secrets,
   checks the live signed catalogue and updates `electron/asset-download.json`.
   This flag records an operator check; the script cannot verify billing plans
   when the account API lacks subscription-read permission.
6. From a fresh Mac test profile, download and render all five avatars and
   texture tiers. Verify unauthenticated requests fail, all ciphertext hashes
   match, cancellation preserves the previous revision and offline restart
   works after initial authorization. Run `npm test`,
   `electron qa/protected-grant.cjs`, and `electron qa/protected-app.cjs`.
7. Run `npm run dmg`. The release guard refuses missing HTTPS configuration or
   private content/signing keys in the installer resources. Verify Apple
   signing, notarization and the absence of raw model files and content keys.
   Confirm bundled encrypted Sarah unlocks without downloading her base. Install with
   existing settings preserved, and repeat a real download from the installer.
8. Publish the new DMG with `node tools/cloud/publish-release.cjs` (below).
   Only after the new release downloads work, remove any old installers that
   embed unprotected models. Keep private backups. Removing release files does
   not revoke copies other people have already downloaded.

## Publishing an installer

The Worker serves three unauthenticated routes under `releases/` on the
gateway host from `electron/asset-download.json`
(`https://gpt-live-avatar-downloads.gpt-live-avatar-downloads.workers.dev/`):

- `releases/latest.json` — the release record the app's **Check for
  Updates…** reads: `{version, title, notes, publishedAt, arch, url, sha256,
  bytes, installers: {arm64: {file, url, sha256, bytes}, "win-x64": {…}}}`.
  One entry per platform; the flat `arch`/`url`/`sha256`/`bytes` fields
  describe the macOS installer, because apps before 0.2.27 read those when
  `installers[arch]` is missing. Cached for five minutes.
- `releases/gpt-live-avatar-<version>-<arch>.dmg` — the Apple-signed,
  notarized macOS installer, and
  `releases/gpt-live-avatar-<version>-win-x64.exe` — the Windows NSIS
  installer, each streamed from the private bucket with
  `Content-Disposition: attachment` and only under its own exact name and
  extension. Installers are immutable per version.
- `releases/` — a small HTML landing page rendered from `latest.json` for the
  README link (version, checksum, a download button per platform, each
  platform's instructions, notes). It links only same-origin installer names.

`index.json`, `authorize` and every encrypted part remain token-authenticated;
`deploy.cjs` and `publish-release.cjs` both verify that an unauthenticated
`index.json` request is still refused.

One-time setup:

1. Redeploy the gateway so it has the routes: `node tools/cloud/prepare-worker.cjs
   FREE_GATEWAY_ACCOUNT_ID` then `node tools/cloud/deploy.cjs --workers-free-confirmed`.
2. In the storage account, create a bucket-scoped **Object Read & Write** R2
   API token for `gpt-live-avatar-protected` and save it privately as
   `build/protected/r2-writer-secret.json` (mode 600, outside git):
   `{"account": "...", "bucket": "gpt-live-avatar-protected",
   "permission": "object-read-write", "accessKeyId": "...",
   "secretAccessKey": "..."}`. The Cloudflare REST API caps single objects at
   300 MiB, so the publisher uploads the DMG through S3 multipart with this
   credential; the Wrangler login is still used for the account-wide storage
   inventory. Never package or upload this file.

Each release:

```bash
npm version patch            # or edit package.json + electron/release-info.json
npm test && npm run dmg      # signed, notarized dist/GPT-Live Avatar-<version>-arm64.dmg
node tools/cloud/publish-release.cjs STORAGE_ACCOUNT_ID gpt-live-avatar-protected            # dry run: checksum, cap plan
node tools/cloud/publish-release.cjs STORAGE_ACCOUNT_ID gpt-live-avatar-protected --apply --retire-previous

# then the Windows installer for the same version, built on Windows
# (npm run dist:win) and copied here with its SHA-256 checked on arrival
node tools/cloud/publish-release.cjs STORAGE_ACCOUNT_ID gpt-live-avatar-protected --target win-x64 --apply
```

The publisher handles one `--target` per run (`arm64` by default, `x64` or
`win-x64`; `--installer PATH`, formerly `--dmg`, overrides the expected file
in `dist/`). It hashes the installer, reads the live `latest.json` and carries
over the other platform's entry for the same version — re-validated with the
app's own parser, so nothing it did not write survives, and never an entry for
another version, whose files this release retires. It builds `latest.json`
from `electron/release-info.json` (or `--notes FILE`) and checks every entry
with that parser, plans the storage cap across the account, uploads the
installer in 64 MiB parts, re-reads and verifies its SHA-256, writes
`latest.json`, retires installers of **older versions** when asked — never the
other platform of the version being published — records
`build/published-release-<version>.json` and `build/SHA256SUMS-<version>.txt`
(one line per installer the release now offers), then confirms every
platform's route and the still-closed catalogue on the live gateway.
`--verify-live` repeats only the live check. When the previous
installer must be retired to fit under the cap it is removed before the
upload, so its download link is unavailable for the minutes the upload takes.
Two installers per release roughly doubles the footprint: read the dry run's
cap plan first. The gateway must have been redeployed with the `.exe` route
(`prepare-worker.cjs`, `deploy.cjs`) before the first Windows publish.
`node qa/publish-release.cjs` covers the plan, multipart transport and
verification locally without credentials.

The legacy iOS client requires a separate protected-loader port before another
public iOS release. Its old raw GitHub endpoint is intentionally not a fallback
in the Mac downloader. Owner-supplied local packages remain usable; migration
never deletes their original licensed files.

## Pruning superseded packs

Uploads only add objects, so every new motion or character revision leaves the
previous packs in the bucket. The gateway serves only what the live signed
inventory names, which makes those leftovers unreachable by every app version:
they cost storage and nothing else. `tools/cloud/prune-r2.cjs` removes exactly
that remainder. It is a dry run by default, never touches a live object or
anything under `releases/`, refuses packs that have no local copy in
`build/protected` (so a removed pack can be uploaded again), stops if the
bucket is missing a live object, and re-checks the live inventory afterwards.

```sh
node tools/cloud/prune-r2.cjs STORAGE_ACCOUNT_ID gpt-live-avatar-protected            # lists what would go
node tools/cloud/prune-r2.cjs STORAGE_ACCOUNT_ID gpt-live-avatar-protected --apply    # permanent
```

Deletion in R2 is permanent; run `--apply` yourself after reading the list.
On 2026-09-18 this took the bucket from 9.15 GB (152 objects) to 6.43 GB, the
104 objects of the live release.

## Motion-only releases (0.2.11+)

`node tools/build-motion-update.cjs REVISION` packages the complete motion library for each character into an encrypted `motions.gla`. It retains the existing model/texture archives and adds `motionUpdate: {revision, package}` outside the catalogue’s `mac` tiers. Earlier apps ignore that optional field and keep their existing downloads. The uploader includes both the old parts and new motion parts, checks the account-wide 10 GB cap before uploading, and the gateway serves only that verified inventory.

A motion overlay must match the base `assetRevision`; its authenticated header has `tier: motions` and `motionRevision`. It may contain only `runtime/motions/` files. The signed download revision and SHA-256 must match before atomic installation. It does not replace the manifest, meshes, wardrobe or textures. New avatar downloads also fetch the current motion overlay. The current encrypted Sarah starter includes it; existing installations can use **Motion update** in Settings.

The Electron asset client uses Chromium `net.fetch` for HTTP/2-capable
transfers. Authorization, catalogue and part requests disable HTTP caching;
the gateway also varies cached responses by Authorization. Origin validation,
redirect rejection, cancellation and per-part/whole-archive SHA-256 checks
remain in the asset layer.
