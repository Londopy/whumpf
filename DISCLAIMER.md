# Disclaimer

**WHUMPF is not a substitute for avalanche education, training, equipment, or
your own judgement in the field.**

## What this software does

WHUMPF **displays** avalanche bulletins published by official regional forecast
centres, and filters terrain according to the parameters those bulletins state.

## What this software does not do

It does not generate, interpolate, extrapolate, modify, or supplement any
avalanche forecast. It is not a forecasting product. It does not tell you
whether a slope is safe.

## Known limitations

**Terrain data contains errors.** Elevation models are derived from LiDAR and
photogrammetry surveys flown in a particular year under particular conditions.
Slope and aspect are computed from that model, not measured on the ground.
Cornices, wind features, recent erosion, and anything built or changed since the
survey will not appear.

**Resolution limits what can be represented.** Terrain attributes are quantized
to roughly 0.35 degrees of slope, 1.4 degrees of aspect, and 16 metres of
elevation. Small terrain features below the grid resolution are invisible.

**A slope not highlighted is not a safe slope.** The overlay shows terrain
matching the parameters of one stated avalanche problem. Avalanches occur
outside forecast problem parameters. Runout zones extend well beyond start
zones, and people are killed in runout while standing on flat ground.

**Bulletins expire.** A bulletin describes expected conditions for a limited
period over a broad forecast region. Conditions vary enormously within a region
and change rapidly with weather. Cached or expired bulletins are marked in the
interface; heed those markings.

**Software fails.** Network requests fail, caches go stale, parsers encounter
payloads they were not written for, and displays can be wrong without appearing
wrong.

## Your responsibility

Always consult the source bulletin directly from the issuing forecast centre.
Travel in avalanche terrain with appropriate training, a partner, and rescue
equipment you know how to use. Make decisions based on conditions you observe.

The authors provide this software as-is, without warranty of any kind, and
accept no liability for any outcome arising from its use. See [LICENSE](LICENSE).

## Attribution

Bulletin content remains the property of the issuing forecast centre and is
displayed with attribution. Terrain and imagery derive from public data
published by USGS, LINZ, and the Copernicus programme.
