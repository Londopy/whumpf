# Verifying WHUMPF against real terrain

Before this tool informs a decision you'd act on, prove it agrees with ground
truth. This is the procedure.

## Why this document exists

Every failure mode that matters here produces a map that looks right.

A mirrored aspect axis, a transposed DEM, a stale bulletin, a band breakpoint
read from the wrong region — none of these render as an error. They render as a
confident, plausible overlay pointing at the wrong slopes. You cannot catch them
by looking at the screen and deciding whether it seems sensible, because it will.

This is not hypothetical. During development we found exactly that bug in a
geospatial library we were evaluating: aspect was mirrored east–west, north and
south were correct, and it had shipped through two releases with a passing test
on top of it. The test asserted one cardinal direction, and a mirrored axis
leaves two of the four correct.

`tests/test_pipeline_end_to_end.py` now asserts all eight compass directions
through the real chain. That covers the software. This document covers
everything downstream of it.

---

## Before you leave: the bench check

Run these once per AOI, and again after any change to the pipeline, the shader,
or the packing format.

**1. The automated chain.**

```bash
make test
```

`test_pipeline_end_to_end.py` puts eight closed-form slopes through
gdaldem → pack → unpack → octant → bulletin mask. If GDAL is installed it uses
the real binary. All eight must pass. There is no partial credit: a mirror
leaves half of them passing.

**2. The round-trip on real data.**

`build_attribute_raster` samples a pixel and asserts it unpacks to what gdaldem
reported. It runs automatically. If it fails, stop — the packed tiles do not
say what the shader will read.

**3. Aspect against a known slope, on screen.**

Pick somewhere in the AOI whose aspect you know cold — a face you have skied,
a road cut, anything unambiguous. Set manual mode, select only that octant, and
set a slope range wide enough not to filter it out.

The slope should light up. Then select the **opposite** octant. It should go
dark. Both halves matter: the first catches a dead filter, the second catches a
mirror.

Do it for a second slope facing a different cardinal, ideally east or west —
those are the two a mirrored axis swaps while leaving north and south intact.

**4. Slope angle against a map.**

Compare the app's slope shading against a printed slope-angle shading map for
the same terrain, or against a known 38° face. Within a few degrees is expected.
Systematically shallow or steep means a cell-size or projection problem.

---

## Known limits

These are properties of the design, not bugs. Know them before trusting a
reading.

**Elevation is quantised to ~15.7 m.** The B channel packs 0–4000 m into 8 bits.
A band boundary at 2400 m is really 2400 ± 8 m. Near a boundary, the overlay
cannot tell you which side you are on. `crates/whumpf-runout` loads a separate
float DEM for this reason.

**Slope is quantised to ~0.35°, aspect to ~1.4°.** Fine for filtering, not for
claiming a slope is 34.8° rather than 35.1°.

**Slope depends on DEM resolution.** A 1 m LiDAR DEM and a 30 m DEM disagree
about the same slope, and the coarser one smooths away small steep features —
including terrain traps and short convex rolls. Check which DEM an AOI is built
from. Neither is wrong; they answer different questions.

**Flat ground reads as north-facing.** `gdaldem -zero_for_flat` returns 0°,
which is a real bearing. In bulletin mode the bulletin's slope minimum excludes
it. In manual mode, dropping the slope minimum to 0 with N selected will paint
every flat area. That is the filter working as specified, not a fault, but it
surprises people the first time.

**DEM data contains errors.** Voids, interpolation artefacts, vegetation
returns misread as ground. A slope that looks anomalous on the overlay and wrong
in person is probably the data, and the data is probably wrong more often than
your eyes.

**The bulletin is a snapshot.** Check the issue and expiry time in the
attribution panel every time. Expired bulletins render grey rather than in
danger colours, deliberately. Grey does not mean safe. It means you do not
currently have a forecast.

---

## What this tool is

It filters terrain by the parameters a published bulletin already states. That
is the whole function.

It does not forecast. It does not assess a slope. It does not know about wind
loading since the bulletin was issued, the cornice above you, what your partner
saw yesterday, or the whumpf you just heard. A slope that is not highlighted is
not thereby safe — it is a slope that does not match the parameters you typed
into a filter.

Read the source bulletin. The link is in the attribution panel, and it is there
because this tool is not a substitute for it.

See [`../DISCLAIMER.md`](../DISCLAIMER.md).

---

## If it disagrees with you

Terrain does not have bugs. Software does.

If the overlay contradicts what you can see, believe your eyes and write down
what you saw. Then check, in this order: which DEM the AOI is built from, the
bulletin's issue time, whether the AOI's band breakpoints match the ones the
forecast centre publishes for that zone, and finally whether
`make test` still passes.

Add a regression test for whatever you find. `tests/test_pipeline_end_to_end.py`
is the right place — it is the file that asserts the thing you thought was true.
