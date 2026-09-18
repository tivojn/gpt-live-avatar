# License compliance handoff — CGTrader character assets

Date: 2026-09-18. Scope: the Mac Electron app only. iOS is out of scope for now.

This document is self-contained. It records what the character licenses allow,
what was verified in the app on 2026-09-18, and the exact work items that
remain. Work through the numbered items in order and tick the acceptance
checks. Do not widen the scope: nothing else in the app needs to change for
license reasons.

## 1. The assets and their licenses

All five shipped characters were bought on CGTrader from the seller
TomCAT-Character-Art under the buyer account `yaowenzhe2018`. The account
profile now carries the company's legal name; the purchases were made on
behalf of that company, which CGTrader's terms allow (definition of "Buyer",
clause 20.5).

| Character | CGTrader model ID | License | Notes |
| --- | --- | --- | --- |
| Tia | 4521676 | Royalty Free, **No AI** | bought 2026-09-05 |
| Sarah (Blender "Sara Rigged Woman") | delisted | Royalty Free (default under clause 20.2) | bought 2023-05-15, product page gone; invoice is the only proof |
| Ming-Mei | 3185811 | Royalty Free | bought 2026-09-13 |
| Iselda | 3283814 | Royalty Free | bought 2026-09-13 |
| Seraphim Trooper Girl | 4978552 | Royalty Free | bought 2026-09-13 |
| SGT Sara (Unreal) | 4318068 | Royalty Free, No AI | bought 2023, **not shipped**; the app filters slug `sgt-sara` out |

No product carries custom license terms, so CGTrader's General Terms sections
20–21 govern everything: <https://www.cgtrader.com/pages/terms-and-conditions>.

### What the license allows

- Shipping the characters inside an application sold to the public, as long
  as the model is not downloadable in its original form and is not sold as
  goods inside the app (clause 21A.2, "Incorporated Product").
- Modifying the models and making derivatives (21A.4). The Sarah wardrobe
  merge, injected pose libraries, shrunk textures and motion retargeting are
  all fine.
- Renders, screenshots and videos for marketing.
- Running the characters through AI services at runtime (GPT-Live voice,
  vision context, reflexes). That is inference and display, not training.

### What the license forbids

- Letting end users extract the model or textures (21A.3 requires
  "commercially reasonable measures", e.g. a proprietary format or
  encryption).
- Selling an avatar itself as an in-app good (21A.2 b).
- Any export, save or share of the model files.
- Selling renders of the characters on stock-media sites (21A.1).
- **Tia and SGT Sara only (No AI, clause 21B):** using the model, its
  renders or metadata as training input for any machine-learning model.
  Ming-Mei, Iselda and Seraphim explicitly allow AI input.
- Claiming the characters as the company's own IP or trademarking them.
  Using the names Tia, Sarah, Ming-Mei, Iselda and Seraphim inside the
  product is allowed (21A.4).
- Passing the CGTrader ZIPs, Blender originals or decrypted GLBs to anyone
  outside the company (20.5).

## 2. What was verified as already compliant (2026-09-18)

Leave these as they are.

- Avatars ship only as encrypted GLAPACK containers
  (`electron/protected-assets.cjs`, AES-256-GCM per chunk, HMAC-signed
  header, keys held by the main process only). The DMG contains
  `Resources/avatars/sarah/{base,motions}.gla` and nothing in plain glTF.
  See `docs/PROTECTED-ASSETS.md`.
- Extra tiers and other characters download from the Cloudflare Worker in
  `electron/asset-download.json`; the catalogue answers HTTP 401 without an
  authorized token.
- The local avatar HTTP endpoint is bound to 127.0.0.1 behind a 64-hex token.
- The git repo tracks no purchased model or texture files (`build/` is
  ignored; only `ios/Resources/thumbnail.png` and vendored ML weights are
  tracked).
- SGT Sara is not shipped: `electron/assets.cjs` filters the slug and
  `electron/main.cjs` rejects it in config.
- No release notes or docs mention weapon brands or "Warhammer".
- No monetisation exists yet, so nothing sells avatars as goods.

## 3. Work items

### Item 1 — Rename the firearm props (all characters)

Why: the prop labels expose real trademarked product names to users. The
owner's decision is to rename, not remove.

Where the labels live:

- Tia: embedded library in the model (`extras.openclamAvatar.props`), built
  by `tools/inject-library.py` from a wardrobe JSON, with colour packs from
  `tools/complete-tia-colors.py` (line ~27 references `Unica6`).
  Current labels: `pistol` → "Unica 6", `rifle` → "FN SCAR 20S".
- Sarah: `tools/complete-sarah.py` lines ~202–203.
  Current labels: `pistol` → "1911 pistol", `rifle` → "FN SCAR 20S".
- Seraphim: `build/characters/seraphim/appearance/index.json` and the
  embedded library. Current labels: `unica` → "Unica 6 revolver"; the
  "Seraphim pistol/revolver" labels are the seller's fictional design and can
  stay.
- Ming-Mei and Iselda ship no props.

Required labels: "Pistol", "Rifle", "Revolver" (or similar generic words).
Keep the prop ids (`pistol`, `rifle`, `unica`) unchanged so saved user
selections and `web/avatar3d-options.js` hand-grip lookups
(`Hndgrp.rifle` / `Hndgrp_pistol`, line ~543) keep working. Do not rename
mesh node names such as `Weap_FN-SCAR-20S.001`; they are never shown.

Also grep `web/` and `electron/` for the strings `Unica`, `SCAR`, `1911` in
any user-visible text, tooltips or Playwright/Director prompts and replace
them with the generic words.

Rebuild the affected character packages and re-upload them with the existing
`tools/cloud/upload-r2.cjs` flow, bumping `assetRevision` as usual.

Acceptance:

- [x] In the app, the prop pickers for Tia, Sarah and Seraphim show only
      generic names (scrubbed at load, see status below).
- [x] `grep -rn "Unica\|SCAR\|1911" web electron` returns nothing
      user-visible (only the scrub table itself).
- [ ] Rebuilt `.gla` packages load and the props still attach to the hand
      (optional now: not rebuilt, labels are scrubbed in the renderer).

### Item 2 — Meshy rig task and the Tia "No AI" clause

Background: on 2026-09-08 `build/motion-audit/meshy-new.py` uploaded Tia's
mesh and textures (`.../tia-interactive/presets/rig-upload.glb`) to Meshy's
rigging API. The resulting task id (`build/motion-audit/new-rig-task.json`,
also `rigTaskId` in `~/.config/gpt-live-avatar/show-motion.json`) is what
Avatar Show sends with every custom-motion request
(`electron/show-motions.cjs`, `tools/show-motion.py`).

The upload itself was inference, not training. The exposure is on Meshy's
side: Meshy's Terms of Use §2.9 let Meshy use non-Enterprise customer inputs
to train and improve its services, and §3.2 gives paid customers an option to
keep content private. Tia is licensed "No AI", so Tia must not be available
to Meshy as training data.

Do this, in order:

1. Check the Meshy account plan and settings at <https://www.meshy.ai>.
   If it is a paid plan, enable the option that keeps user content private /
   excludes it from training. Record the plan and the setting in this file.
2. If that setting is now on, the existing rig task may be kept. Stop here.
3. If the account is on the free plan or no such setting exists:
   - In the Meshy dashboard delete the rig task
     `01a0a3f6-c5f0-707d-ab39-412a84bfd472` and any uploaded Tia asset.
   - Export a rig-upload GLB from Ming-Mei, Iselda or Seraphim (their
     licenses allow AI input) or from a neutral body on the same Female-A
     skeleton, using the same mesh set as the original upload.
   - Run `meshy-new.py` with `src` pointing at that file, save the new task
     id into `show-motion.json` (`rigTaskId`) and `new-rig-task.json`.
   - Generate one test motion through Avatar Show and confirm it retargets to
     Tia and Sarah.

Rule going forward: never upload Tia or SGT Sara files (mesh, textures,
renders, blendshape data) to any AI service that may train on inputs. The
runtime path is fine because it sends only a text prompt and the rig id.

Acceptance:

- [ ] Meshy plan and privacy setting recorded here: ________
- [ ] Either the private setting is on, or the rig task has been replaced
      and the old one deleted.
- [ ] A custom motion still generates and plays.

### Item 3 — Invoices on file

Download the six invoice PDFs from
<https://www.cgtrader.com/profile/purchases> (Invoice button per row; order
17839554 covers Ming-Mei, Seraphim and Iselda; the 2023 orders cover Sarah
and SGT Sara; Tia is its own 2026-09-05 order). Store them outside the git
repo, for example in the company's document store, together with a short
signed memo stating that purchases on CGTrader account `yaowenzhe2018` were
made on behalf of the company for GPT-Live Avatar.

Then email support@cgtrader.com asking for the invoices to be re-issued with
the company's legal name, address and tax ID.

Acceptance:

- [x] Four invoice PDFs archived (they cover all six items).
- [ ] Memo drafted and archived; owner still to sign.
- [ ] Re-issue request sent (attach CGTrader's reply when it arrives).

### Item 4 — Repo visibility and the updater

The owner intends to make `tivojn/gpt-live-avatar` private. Two things depend
on it being public today:

- `electron/releases.cjs` checks
  `https://api.github.com/repos/tivojn/gpt-live-avatar/releases/latest`
  for updates and links users to the releases page.
- `README.md` points users at the GitHub releases page for the DMG.

Before flipping visibility, move DMG hosting and the update check to a host
that does not need GitHub auth (for example the existing Cloudflare Worker /
R2 bucket or a static site), update both references, and ship a release that
uses the new update endpoint so existing installs can still find the next
one.

If the repo stays public for any period, add a `LICENSE` file (MIT for the
code, matching `package.json`) and a `THIRD-PARTY-NOTICES.md` stating that
the character assets are licensed from TomCAT-Character-Art via CGTrader,
are not covered by MIT, and may not be extracted or redistributed. Once the
repo is private these files are optional.

Status (2026-09-18): implemented in the working tree. The Worker serves
public `releases/latest.json`, `releases/<installer>.dmg` and a `releases/`
landing page; `electron/releases.cjs` reads the service first and falls back
to GitHub only when it is unreachable; `README.md` links the landing page;
`tools/cloud/publish-release.cjs` uploads a release. Remaining owner steps:
redeploy the gateway, create the writer credential, publish v0.2.22 through
the new service **and** as a final GitHub release (so v0.2.21 and older
installs, which only know GitHub, can find it), then flip visibility. See
`docs/PROTECTED-ASSETS.md`, "Publishing an installer".

Acceptance:

- [ ] Updater and README no longer depend on public GitHub releases.
- [ ] Repo visibility changed only after that release is out.

## 4. Standing rules for future work

Anyone changing the app must keep these true.

1. No export, save, reveal or share feature for avatar files, ever.
2. Any future monetisation charges for the app or features. Never sell an
   avatar as a purchasable item that delivers the asset.
3. No training of any model on Tia or SGT Sara data. Ming-Mei, Iselda and
   Seraphim may be used as AI input.
4. Keep the wardrobe non-adult: no underwear or nude outfits in shipped
   packages (the body-brief shader and the dropped bikini outfit already
   handle the current set).
5. Do not use weapon brand names or "Warhammer" in the UI, release notes or
   marketing.
6. Do not describe the characters as company IP or file trademarks on them.
7. Collaborators and AI coding agents get encrypted builds and packages
   only, never the CGTrader ZIPs, Blender originals or decrypted GLBs.
8. Keep `build/` ignored in git; never commit models, textures or `.gla`
   packages.
9. Keep the legal name, not the "Adam Cohen" pseudonym, on anything that is a
   legal record: invoices, the App Store seller, contracts.

## 5. Reference

- CGTrader terms: <https://www.cgtrader.com/pages/terms-and-conditions>
  (sections 20, 21A, 21B).
- Meshy Terms of Use: <https://www.meshy.ai/terms-of-use> (§2.9 training on
  customer content, §3.2 private option for paid plans, §2.5 retention).
- Asset protection design: `docs/PROTECTED-ASSETS.md`.
- Avatar Show / Meshy pipeline: `docs/AVATAR-SHOW.md`,
  `electron/show-motions.cjs`, `tools/show-motion.py`.
- Character build tools: `tools/inject-library.py`, `tools/complete-sarah.py`,
  `tools/complete-tia-colors.py`, `tools/export-character.py`.

## 6. Status log

### 2026-09-18 afternoon

- **Invoices (Item 3):** all four invoice PDFs downloaded from CGTrader and
  stored in `~/Documents/GPT-Live Avatar Licenses/` together with
  `ownership-memo.md`, a memo for Wenzhe Yao to sign as Director of The
  Great Lionheart Pte. Ltd. (spelling to be checked against the ACRA
  record). The CGTrader profile Full name is now "WENZHE YAO". The
  re-issue request to support@cgtrader.com has not been sent yet.
- **Firearm props (Item 1):** done without rebuilding packages. The renderer
  now scrubs real product names when a character library loads
  (`scrubBrandNames` in `web/avatar3d-options.js`): "FN SCAR 20S" → Rifle,
  "Unica 6" / "Unica 6 revolver" → Revolver, "1911 pistol" → Pistol.
  Fictional labels such as "Seraphim pistol" are untouched. Prop ids and
  mesh node names are unchanged, so saved selections and hand grips still
  work. `tools/complete-sarah.py` now emits the generic labels, so the next
  Sarah rebuild is clean at the source; Tia and Seraphim packages keep the
  old strings inside the encrypted data, which is not user-visible.
- **Meshy (Item 2):** not started; the owner checks the plan and privacy
  setting first.
- **Repo / updater (Item 4):** implemented in the working tree, not yet
  deployed. The Worker gains a public `releases/` prefix (`latest.json`, the
  DMG, a small landing page); `electron/releases.cjs` reads it first and
  falls back to the GitHub API only when the service is unreachable;
  README and About copy no longer point at GitHub. Owner steps before the
  repo goes private: deploy the Worker (`tools/cloud/deploy.cjs`), create a
  bucket-scoped Object Read & Write R2 token saved as
  `build/protected/r2-writer-secret.json`, publish the next version with
  `tools/cloud/publish-release.cjs --apply --retire-previous`, and publish
  that same version on GitHub once more so installs at or below 0.2.21 can
  still find the update. The About window's "View on GitHub" button is left
  for the owner to decide. Details in `docs/PROTECTED-ASSETS.md`.
- **Not license work, done the same day:** Avatar Show panel header is
  sticky; recorded MP4 audio is delayed to match the on-screen mouth
  (`web/show-recorder.js`, `SpeechOutput.playbackLag`).
