# Week 1 gates — Aug 3–9

Four items. Two are five-minute admin tasks that silently invalidate eight weeks
of work if missed. Do those first.

---

## 🔴 Blocking — do today

### 1. Academic email on Devpost

Next Gen eligibility is verified against [JetBrains/swot](https://github.com/jetbrains/swot).
A personal gmail address **will fail**. The team Representative's Devpost
account needs a `.edu`-or-equivalent address.

- [ ] Decide who is Representative
- [ ] That account's Devpost email is academic
- [ ] Checked it against the domain list on https://www.shipaton.com/next-gen
- [ ] Registered for Shipaton on Devpost

### 2. LICENSE renders in the About sidebar

The rules require the license be *detectable and visible*. GitHub only populates
the About sidebar from a recognised license file at repo root.

- [ ] `LICENSE` committed at root (done — MIT)
- [ ] Pushed, and "MIT License" is visible in the sidebar at
      https://github.com/Londopy/whumpf
- [ ] Repo is public

---

## 🟠 Data gates — decide by Aug 9

### 3. 3DEP 1m coverage over Castle Peak

- [ ] Checked the National Map viewer for the exact bbox
      `-120.42, 39.28 → -120.28, 39.38`
- [ ] Download started (it is slow — start it before anything else)
- [ ] If gaps: fall back to 3DEP 1/3 arc-second and update
      `config/aoi/castle-peak.toml`

### 4. NZ LiDAR coverage over Craigieburn — ⭐ gates the live demo

This is the one that makes the Sep 30 demo show real, current bulletin data.

- [ ] LINZ account + API key in `.env`
- [ ] LiDAR DEM coverage confirmed for `171.60, -43.20 → 171.85, -43.05`
- [ ] `layer_id` filled into `config/aoi/craigieburn.toml`
- [ ] If no LiDAR: fall back to LINZ 8m national DEM (still far better than the
      30m global DEM every other app uses)
- [ ] If the region is unusable entirely: switch to Tongariro or Wakatipu.
      **Do not** fall back to a second US AOI — that loses live data, which is
      the entire point.

### 5. NZAA bulletin endpoint

`api/bulletin/nzaa.py` is a stub. The payload shape is unverified.

- [ ] Open https://www.avalanche.net.nz/ with the network tab open
- [ ] Find the JSON endpoint behind the advisory pages (it is a JS app)
- [ ] Capture a real payload → `api/fixtures/nzaa-sample.json`
- [ ] Note: region identifiers · danger encoding (int or label?) · rose
      representation · band names · timestamp timezone (NZST/NZDT, not UTC)
- [ ] Rewrite `NZAAAdapter.normalize()` against what is actually there
- [ ] Set `use_fixture = false` in `config/aoi/craigieburn.toml`

Until this lands the adapter raises and falls back to the fixture, so the API
stays functional.

---

## Also this week

- [ ] Cesium ion account + token in `.env`
- [ ] Cloudflare R2 bucket created
- [ ] `make check` passes
- [ ] Tests pass: `pytest`
- [ ] Rust: `cd crates/whumpf-runout && cargo test` (unverified — no toolchain
      was available when this was scaffolded)
- [ ] Client: Cesium scaffold against World Terrain, chrome stripped
- [ ] Replace `api/fixtures/sac-2026-02-14.json` with the **real** captured SAC
      payload — the current file is synthetic and labelled as such
- [ ] Start posting #BuildInPublic. The topo-correction before/after is the most
      postable image in this project.

---

## Checkpoint — end of week 1

> **Real 1m Castle Peak terrain visible in the browser.**
> If not, stop and fix it. Everything downstream depends on this.
