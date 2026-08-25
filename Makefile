.PHONY: help check test lint api web web-install web-check web-build \
        changelog release terrain attributes imagery all clean

AOI ?= castle-peak
PY  ?= python

help:
	@echo "WHUMPF pipeline"
	@echo ""
	@echo "  make check                    verify GDAL + deps + AOI config"
	@echo "  make test                     python test suite"
	@echo "  make lint                     ruff"
	@echo "  make api                      run the Flask dev server"
	@echo ""
	@echo "  make web                      run the Vite dev server (needs make api too)"
	@echo "  make web-check                typecheck + smoke + contract + ui"
	@echo "  make web-build                production build"
	@echo "  make changelog                validate CHANGELOG.md"
	@echo "  make release V=0.3.0          bump changelog + versions, then tag by hand"
	@echo ""
	@echo "  make terrain    AOI=<slug>    DEM -> warp -> clip -> ion"
	@echo "  make attributes AOI=<slug>    slope/aspect/elev -> packed PNG tiles"
	@echo "  make imagery    AOI=<slug>    Sentinel-2 composite -> JPEG tiles"
	@echo "  make all        AOI=<slug>    every stage"
	@echo ""
	@echo "  AOIs: castle-peak (fixture) craigieburn (live)"
	@echo "  current AOI = $(AOI)"

check:
	$(PY) -m pipeline.cli check

test:
	pytest -q

lint:
	ruff check .

api:
	flask --app api.app run --debug

web-install:
	cd web && npm install

# Everything CI runs for the web client. The Cesium layers are deliberately
# absent -- they need WebGL, and a green check that skips them is worse than
# an honest gap. See web/PORTING-STATUS.md.
web-check:
	cd web && npm run check

web-build:
	cd web && npm run build

web:
	cd web && npm run dev

changelog:
	patchnotes CHANGELOG.md validate

# Moves [Unreleased] into a dated release and syncs the version everywhere.
# Commit and tag yourself -- the tag is what triggers the release workflow.
release:
	@test -n "$(V)" || { echo "usage: make release V=0.3.0"; exit 2; }
	$(PY) scripts/release.py $(V)

terrain:
	$(PY) -m pipeline.cli terrain --aoi $(AOI)

attributes:
	$(PY) -m pipeline.cli attributes --aoi $(AOI)

imagery:
	$(PY) -m pipeline.cli imagery --aoi $(AOI)

all:
	$(PY) -m pipeline.cli all --aoi $(AOI)

clean:
	rm -rf data/$(AOI)
	@echo "removed data/$(AOI) -- source downloads are gone too"
