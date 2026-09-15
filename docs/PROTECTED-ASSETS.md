# Protected character delivery

The Mac app uses a private Cloudflare R2 Standard bucket and a narrow Worker
endpoint. The installer includes encrypted Tia with her appearance controls and
motions, so first launch needs only a brief online unlock. Tia then works offline.
Other characters and larger texture tiers download from R2.

GitHub hosts source and the installer; purchased character files are
not source-code dependencies and must not be uploaded to public releases as
GLB, Blender, texture ZIP, or plaintext avatar folders.

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
wrapping, rejected requests and HEAD checks perform no R2 operations. This
bounds public downloads to at most 3.1 million R2 reads in a 31-day month, below
R2 Standard's 10 million monthly Class B allowance. Requests stop when Workers
Free reaches its limit; they do not automatically upgrade the account.

The public gateway and R2 can live in separate accounts. In this deployment,
R2 stays in the existing storage account and a new Workers Free account hosts
the gateway. The gateway uses a bucket-scoped **Object Read only** S3 credential
configured as a Worker secret; the maintainer retains its private local setup
copy. It is never packaged in the app or disclosed to download clients. The gateway signs a single private S3 GET and streams it;
it never returns credentials or presigned URLs to clients. Redirects and
automatic storage retries are disabled to preserve the one-read bound.

The uploader sums objects across the account's buckets and refuses a planned
peak above **10,000,000,000 bytes**, including retained releases. It accepts only
the signed catalogue and encrypted download parts, uses Standard storage, and
verifies every remote SHA-256 checksum. It never uploads the duplicate complete
archives, private build files or raw sources. Unknown inventory, pagination or
storage classes fail closed.

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
`r2.dev` and public custom bucket domains disabled. The Worker needs only GET;
do not add listing, upload, transcoding, AI or other billable routes.

Current release input: five characters × three tiers, 15 logical archives,
95 ciphertext parts plus the signed catalogue, **5,986,682,229 bytes** total.
Whole local `.gla` files are not uploaded as additional objects.

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Maintainer build and migration

1. Put licensed, verified package directories at `build/characters/<slug>` for
   `tia`, `sarah`, `iselda`, `ming-mei` and `seraphim`. These stay outside git.
2. Run `npm run build-protected-assets`. It preserves the private release key
   file, builds the three tiers, round-trips every file against its source,
   signs the catalogue, links encrypted Tia into `build/protected/starter`, and
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
   Confirm bundled encrypted Tia unlocks without downloading her base. Install with
   existing settings preserved, and repeat a real download from the installer.
8. Publish the new DMG and source. Only after the new release downloads work,
   remove the old public `assets-v1` model/ZIP files and any old installers that
   embed unprotected models. Keep private backups. Removing release files does
   not revoke copies other people have already downloaded.

The legacy iOS client requires a separate protected-loader port before another
public iOS release. Its old raw GitHub endpoint is intentionally not a fallback
in the Mac downloader. Owner-supplied local packages remain usable; migration
never deletes their original licensed files.

## Motion-only releases (0.2.11+)

`node tools/build-motion-update.cjs REVISION` packages the complete motion library for each character into an encrypted `motions.gla`. It retains the existing model/texture archives and adds `motionUpdate: {revision, package}` outside the catalogue’s `mac` tiers. Earlier apps ignore that optional field and keep their existing downloads. The uploader includes both the old parts and new motion parts, checks the account-wide 10 GB cap before uploading, and the gateway serves only that verified inventory.

A motion overlay must match the base `assetRevision`; its authenticated header has `tier: motions` and `motionRevision`. It may contain only `runtime/motions/` files. The signed download revision and SHA-256 must match before atomic installation. It does not replace the manifest, meshes, wardrobe or textures. New avatar downloads also fetch the current motion overlay. The encrypted Tia starter includes it; existing installations can use **Motion update** in Settings.

The Electron asset client uses Chromium `net.fetch` for HTTP/2-capable
transfers. Authorization, catalogue and part requests disable HTTP caching;
the gateway also varies cached responses by Authorization. Origin validation,
redirect rejection, cancellation and per-part/whole-archive SHA-256 checks
remain in the asset layer.
