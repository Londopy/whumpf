import numpy as np
import pytest

from pipeline.attributes import (
    ASPECT_STEP,
    ELEV_STEP,
    OCTANT_NAMES,
    SLOPE_STEP,
    aspect_to_octant,
    aspects_to_bitmask,
    pack,
    unpack,
)


def test_round_trip_within_quantisation_error():
    slope = np.array([[0.0, 27.0, 34.9, 45.0, 90.0]], dtype=np.float32)
    aspect = np.array([[0.0, 45.0, 180.0, 270.0, 359.0]], dtype=np.float32)
    elev = np.array([[0.0, 1200.0, 2400.0, 3000.0, 4000.0]], dtype=np.float32)

    got = unpack(pack(slope, aspect, elev))

    assert np.all(np.abs(got["slope_deg"] - slope) <= SLOPE_STEP)
    assert np.all(np.abs(got["aspect_deg"] - aspect) <= ASPECT_STEP)
    assert np.all(np.abs(got["elev_m"] - elev) <= ELEV_STEP)
    assert np.all(got["valid"])


def test_documented_precision_holds():
    assert SLOPE_STEP == pytest.approx(0.353, abs=0.001)
    assert ASPECT_STEP == pytest.approx(1.412, abs=0.001)
    assert ELEV_STEP == pytest.approx(15.686, abs=0.001)


def test_elevation_channel_stays_too_coarse_for_runout():
    # If this ever shrinks, revisit whether runout can reuse these tiles.
    assert ELEV_STEP > 10.0


def test_nodata_marked_invalid():
    shape = (2, 2)
    valid = np.array([[True, False], [False, True]])
    rgba = pack(np.zeros(shape), np.zeros(shape), np.zeros(shape), valid)
    assert np.array_equal(unpack(rgba)["valid"], valid)


def test_aspect_wraps_at_north():
    assert aspect_to_octant(0.0) == 0
    assert aspect_to_octant(359.0) == 0
    assert aspect_to_octant(22.0) == 0
    assert aspect_to_octant(338.0) == 0
    assert aspect_to_octant(23.0) == 1


def test_octant_centres():
    for i, name in enumerate(OCTANT_NAMES):
        assert aspect_to_octant(i * 45.0) == i, name


def test_negative_aspect_is_clamped_not_wrapped():
    # gdaldem emits -9999 for flat cells.
    got = unpack(pack(np.array([[0.0]]), np.array([[-9999.0]]), np.array([[0.0]])))
    assert got["aspect_deg"][0, 0] == pytest.approx(0.0, abs=ASPECT_STEP)


def test_bitmask_matches_shader_convention():
    assert aspects_to_bitmask(["N"]) == 0b00000001
    assert aspects_to_bitmask(["NE"]) == 0b00000010
    assert aspects_to_bitmask(["N", "NE", "E"]) == 0b00000111
    assert aspects_to_bitmask(["S", "SE"]) == 0b00011000
    assert aspects_to_bitmask([]) == 0


def test_bitmask_rejects_garbage():
    with pytest.raises(ValueError, match="unknown aspect"):
        aspects_to_bitmask(["NNE"])


def test_shader_filter_agreement():
    # Replicates the GLSL match expression for: N/NE/E, 2400-3000 m, 30-45 deg.
    slope = np.array([[35.0, 35.0, 20.0, 35.0]], dtype=np.float32)
    aspect = np.array([[10.0, 180.0, 10.0, 10.0]], dtype=np.float32)
    elev = np.array([[2600.0, 2600.0, 2600.0, 1000.0]], dtype=np.float32)

    got = unpack(pack(slope, aspect, elev))
    mask = aspects_to_bitmask(["N", "NE", "E"])
    octant = aspect_to_octant(got["aspect_deg"])

    match = (
        ((mask & (1 << octant)) != 0)
        & (got["elev_m"] >= 2400)
        & (got["elev_m"] <= 3000)
        & (got["slope_deg"] >= 30)
        & (got["slope_deg"] <= 45)
    )

    # in range | wrong aspect | too shallow | too low
    assert match.tolist() == [[True, False, False, False]]


def test_pack_rejects_shape_mismatch():
    with pytest.raises(ValueError, match="shape mismatch"):
        pack(np.zeros((2, 2)), np.zeros((3, 3)), np.zeros((2, 2)))
