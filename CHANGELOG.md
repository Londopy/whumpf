# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Ported the working client from `kiy-codes/contour-map` onto whumpf's stack:
  GPX/GeoJSON/KML, geodesy, route analysis, Garmin export, tile caching and
  offline regions transferred near-verbatim; MapLibre layers rewritten
  against Cesium
- `GET /api/aoi/<slug>/features` — ski runs, lifts and trails per AOI from
  OpenStreetMap via Overpass, cached 24h
- Layers panel and feature info panel in the web client
- `tests/test_terrain_reference.py` — in-repo Horn (1981) slope/aspect
  reference, verified against analytically-known planes, so the numbers
  `gdaldem` produces can be checked against something that lives with the code
- Release automation: `scripts/release.py`, changelog validation in CI, and a
  tag-triggered release workflow that builds the GitHub Release body from
  this file (all via `patchnotes`)
- CI now covers `web/` (typecheck, smoke, contract, UI, build) and guards the
  captured API response against going stale

- End-to-end aspect verification (`tests/test_pipeline_end_to_end.py`): all
  eight compass directions through terrain → gdaldem → pack → unpack → octant →
  bulletin mask, plus the negative case for each. Existing tests covered every
  link in isolation; none asserted that a slope facing NE reads as NE
- `docs/FIELD-VERIFICATION.md` — bench and on-snow checks before the overlay
  informs a decision, and the quantisation and DEM limits that are properties
  of the design rather than bugs
- `pipeline.cli terrain --dem <tif>` accepts a hand-downloaded DEM, so the
  stubbed `download()` no longer blocks the pipeline. `--upload-ion` is now
  opt-in: the terrain mesh and the attribute overlay are independent, and
  World Terrain is a fine base while the overlay becomes real
- `GET /api/tiles/<slug>/<kind>/<z>/<x>/<y>.png` serves locally-built tiles, so
  real terrain attributes need no object store or credentials
- `VITE_ATTRIBUTE_TILES` switches the shader from the synthetic test tile to
  real packed tiles, and the client shows a permanent
  "SYNTHETIC TERRAIN — NOT THIS MOUNTAIN" badge whenever it is unset

### Changed

- Documentation brought in line with the port: `README.md` (status, layout,
  setup, running the client, releasing), `CONTRIBUTING.md` (Node setup, the
  changelog requirement CI enforces, what the web checks do and do not cover),
  `web/README.md`, the PR template, and the spec's status line
- `Makefile` gained `web`, `web-check`, `web-build`, `changelog` and `release`
  targets — the web client and the release path were previously invisible here
- `.gitignore` covers the release artifacts `release.yml` writes into the
  checkout (`RELEASE_NOTES.md`, `whumpf-web-*.zip`)

- Repository scaffold: pipeline, API, Rust runout crate, tests, CI
- AOI configuration system covering Castle Peak (US) and Craigieburn (NZ)
- Packed terrain attribute encoding (slope/aspect/elevation into RGBA) with
  round-trip tests
- Normalized bulletin schema with adapters for avalanche.org and NZAA
- Alpha-angle runout kernel with synthetic-cone tests
- `DISCLAIMER.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`

### Known gaps

- `NZAAAdapter.fetch_raw` is a stub; the NZAA payload shape is unverified
- Both bulletin fixtures are synthetic and labelled as such
- `pipeline/terrain.py` download and ion upload are stubs
- `pipeline/imagery.py` STAC search and LAB detail blend are stubs
- `/api/route/analyze` returns 501

## [0.2.0] — 2026-08-03

### Changed

- Renamed from ASPECT to WHUMPF
- Spec rewritten for an 8-week, three-hackathon timeline targeting a native
  mobile app rather than a 48-hour web-only build
- Added a Southern Hemisphere AOI so the September demo can run on live
  bulletin data rather than a snapshot

[Unreleased]: https://github.com/Londopy/whumpf/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Londopy/whumpf/releases/tag/v0.2.0
