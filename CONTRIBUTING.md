# Contributing

Thanks for looking. WHUMPF is a two-person project built for the 2026 hackathon
season, but the code is MIT and contributions are welcome.

## Before you start

Read [DISCLAIMER.md](DISCLAIMER.md). This project displays public-safety
information. That constrains what changes are acceptable in ways that are not
obvious from the code alone.

## Before your first commit

Git embeds `user.email` in every commit, permanently and publicly. Use your
GitHub noreply address rather than a personal one:

```bash
git config user.name  "your-github-handle"
git config user.email "ID+handle@users.noreply.github.com"
```

Find that exact address under GitHub → Settings → Emails. While you are there,
enable **Keep my email addresses private** and **Block command line pushes that
expose my email**.

This is repo-local config, so it does not affect your other projects.

## Setup

Requires Python 3.11+ and GDAL 3.6+ with the CLI tools on `PATH`.

```bash
# GDAL
brew install gdal                         # macOS
sudo apt install gdal-bin libgdal-dev     # Debian/Ubuntu

python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env

make check    # verifies toolchain, deps, and AOI config
pytest
```

Rust kernel:

```bash
cd crates/whumpf-runout
cargo test
cargo clippy --all-targets -- -D warnings
```

## Ground rules

**Never weaken a safety surface.** Attribution lines, staleness banners, expiry
handling, and the fixture-vs-live label are not decoration. A PR that removes or
hides one will be rejected regardless of how much cleaner it makes the UI.

**Fail closed.** When a bulletin cannot be parsed, an expiry cannot be read, or
a rose is unusable, prefer showing nothing over showing a guess. Existing code
does this deliberately — `Bulletin.is_stale` returns `True` on an unparseable
timestamp, and the avalanche.org adapter skips problems whose rose it cannot
read.

**Never invent forecast data.** Fixtures must be captured from real published
bulletins, or clearly labelled synthetic. Do not fill gaps with plausible
numbers.

**Keep `unpack()` and the shader in sync.** `pipeline/attributes.py::unpack` and
the GLSL/HLSL in the clients implement the same decoding. If they drift, the
overlay is wrong in a way that still looks plausible. Change both, and update
`tests/test_attributes.py::test_shader_filter_agreement`.

**Elevation bands are per-AOI.** Band breakpoints come from the forecast centre
and differ between regions. Never hardcode them.

**Nothing assumes a hemisphere.** Loaded aspects are data, not constants. In New
Zealand they are southerly.

## Style

- Python: `ruff check .`, line length 100. Type hints on public functions.
- Rust: `cargo fmt`, clippy clean.
- Comments explain *why*, not *what*. If the code needs a paragraph to explain
  what it does, rewrite the code.

## Tests

Anything touching the packed encoding, the bulletin normalizer, or band
resolution needs a test. Those three are where a bug is invisible.

The Rust kernel is tested against a synthetic cone DEM with a known analytic
answer — test natively with `cargo test` before building for WASM.

## Pull requests

1. Branch off `main`
2. Keep it focused — one concern per PR
3. `pytest` and `cargo test` pass
4. Explain the *why* in the description
5. Note any change to a safety surface explicitly

## Reporting problems

Bugs and features: [open an issue](https://github.com/Londopy/whumpf/issues).

Security issues, and any bug where **incorrect information could be shown as
correct**, go through [SECURITY.md](SECURITY.md) instead.
