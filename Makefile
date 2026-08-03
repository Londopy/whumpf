.PHONY: help check test lint api terrain attributes imagery all clean

AOI ?= castle-peak
PY  ?= python

help:
	@echo "WHUMPF pipeline"
	@echo ""
	@echo "  make check                    verify GDAL + deps + AOI config"
	@echo "  make test                     run the test suite"
	@echo "  make lint                     ruff"
	@echo "  make api                      run the Flask dev server"
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
