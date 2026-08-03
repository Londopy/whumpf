# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
