//! Avalanche runout: alpha-angle energy line over a DEM grid.
//!
//! A slide from a release point runs out to where the line back to that point
//! drops below alpha. A cell is in the runout if it is downslope-connected to
//! the release point and:
//!
//! ```text
//! atan((z_release - z_cell) / horizontal_distance) >= alpha
//! ```
//!
//! Typical alpha is 18-25 deg; 23 is a conservative default for large slides.
//!
//! Builds to WASM (`--features wasm`) and to native static libs for iOS and
//! Android. Feed it the raw f32 DEM, not the packed attribute tiles -- their
//! elevation channel quantizes to ~15.7 m.

#![allow(clippy::needless_range_loop)]

use std::collections::VecDeque;

pub const DEFAULT_ALPHA_DEG: f32 = 23.0;

const NEIGHBOURS: [(i32, i32); 8] = [
    (-1, -1), (0, -1), (1, -1),
    (-1, 0),           (1, 0),
    (-1, 1),  (0, 1),  (1, 1),
];

pub struct RunoutEngine {
    dem: Vec<f32>,
    width: u32,
    height: u32,
    cell_size: f32,
}

impl RunoutEngine {
    pub fn new(dem: &[f32], width: u32, height: u32, cell_size: f32) -> Self {
        assert_eq!(
            dem.len(),
            (width as usize) * (height as usize),
            "DEM length does not match width*height"
        );
        assert!(cell_size > 0.0, "cell_size must be positive");
        Self { dem: dem.to_vec(), width, height, cell_size }
    }

    #[inline]
    fn idx(&self, x: u32, y: u32) -> usize {
        (y as usize) * (self.width as usize) + (x as usize)
    }

    #[inline]
    fn z(&self, x: u32, y: u32) -> f32 {
        self.dem[self.idx(x, y)]
    }

    /// Mask with the same dimensions as the DEM.
    /// 0 = outside the runout, 1-255 = arrival intensity.
    pub fn compute(&self, start_x: u32, start_y: u32, alpha_deg: f32) -> Vec<u8> {
        let n = (self.width as usize) * (self.height as usize);
        let mut mask = vec![0u8; n];

        if start_x >= self.width || start_y >= self.height {
            return mask;
        }

        let tan_alpha = alpha_deg.to_radians().tan();
        let z_release = self.z(start_x, start_y);

        let mut visited = vec![false; n];
        let mut queue: VecDeque<(u32, u32)> = VecDeque::new();

        let start = self.idx(start_x, start_y);
        visited[start] = true;
        mask[start] = 255;
        queue.push_back((start_x, start_y));

        while let Some((x, y)) = queue.pop_front() {
            let z_here = self.z(x, y);

            for (dx, dy) in NEIGHBOURS {
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                if nx < 0 || ny < 0 || nx >= self.width as i32 || ny >= self.height as i32 {
                    continue;
                }
                let (nx, ny) = (nx as u32, ny as u32);
                let ni = self.idx(nx, ny);
                if visited[ni] {
                    continue;
                }

                let z_next = self.z(nx, ny);
                if !z_next.is_finite() || z_next >= z_here {
                    continue;
                }

                let ddx = (nx as f32 - start_x as f32) * self.cell_size;
                let ddy = (ny as f32 - start_y as f32) * self.cell_size;
                let horiz = (ddx * ddx + ddy * ddy).sqrt();
                if horiz <= 0.0 {
                    continue;
                }

                let drop = z_release - z_next;
                if drop / horiz < tan_alpha {
                    continue; // past the runout on this path
                }

                let ratio = (drop / horiz - tan_alpha) / tan_alpha.max(1e-6);
                mask[ni] = 1 + (ratio.clamp(0.0, 1.0) * 254.0) as u8;

                visited[ni] = true;
                queue.push_back((nx, ny));
            }
        }

        mask
    }

    pub fn width(&self) -> u32 { self.width }
    pub fn height(&self) -> u32 { self.height }
}

#[cfg(feature = "wasm")]
mod wasm {
    use super::*;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen(js_name = RunoutEngine)]
    pub struct WasmRunoutEngine(RunoutEngine);

    #[wasm_bindgen(js_class = RunoutEngine)]
    impl WasmRunoutEngine {
        #[wasm_bindgen(constructor)]
        pub fn new(dem: &[f32], width: u32, height: u32, cell_size: f32) -> Self {
            console_error_panic_hook::set_once();
            Self(RunoutEngine::new(dem, width, height, cell_size))
        }

        pub fn compute(&self, start_x: u32, start_y: u32, alpha_deg: f32) -> Vec<u8> {
            self.0.compute(start_x, start_y, alpha_deg)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cone with apex at the centre and constant outward slope.
    fn cone(size: u32, cell_size: f32, slope_deg: f32, apex_z: f32) -> Vec<f32> {
        let c = (size as f32 - 1.0) / 2.0;
        let tan_s = slope_deg.to_radians().tan();
        let mut dem = vec![0.0f32; (size * size) as usize];
        for y in 0..size {
            for x in 0..size {
                let dx = (x as f32 - c) * cell_size;
                let dy = (y as f32 - c) * cell_size;
                let r = (dx * dx + dy * dy).sqrt();
                dem[(y * size + x) as usize] = apex_z - r * tan_s;
            }
        }
        dem
    }

    #[test]
    fn cone_steeper_than_alpha_runs_to_the_edge() {
        let size = 61;
        let cell = 10.0;
        let dem = cone(size, cell, 30.0, 2000.0);
        let e = RunoutEngine::new(&dem, size, size, cell);
        let mask = e.compute(size / 2, size / 2, 23.0);

        assert_eq!(mask[(size / 2 * size + size / 2) as usize], 255);
        assert!(mask[0] > 0);
    }

    #[test]
    fn cone_shallower_than_alpha_stops_at_the_release_cell() {
        let size = 61;
        let dem = cone(size, 10.0, 15.0, 2000.0);
        let e = RunoutEngine::new(&dem, size, size, 10.0);
        let mask = e.compute(size / 2, size / 2, 23.0);

        assert_eq!(mask.iter().filter(|&&v| v > 0).count(), 1);
    }

    #[test]
    fn lower_alpha_reaches_at_least_as_far() {
        let size = 61;
        let dem = cone(size, 10.0, 25.0, 2000.0);
        let e = RunoutEngine::new(&dem, size, size, 10.0);

        let n = |a: f32| e.compute(size / 2, size / 2, a).iter().filter(|&&v| v > 0).count();
        assert!(n(18.0) >= n(23.0));
        assert!(n(23.0) >= n(30.0));
    }

    #[test]
    fn flow_never_goes_uphill() {
        let size = 41;
        let dem = cone(size, 10.0, 30.0, 2000.0);
        let e = RunoutEngine::new(&dem, size, size, 10.0);
        let start = size / 2;
        let mask = e.compute(start, start, 23.0);
        let release = (start * size + start) as usize;
        let z_release = dem[release];

        for i in 0..mask.len() {
            if mask[i] > 0 && i != release {
                assert!(dem[i] < z_release);
            }
        }
    }

    #[test]
    fn out_of_bounds_start_is_empty() {
        let dem = cone(21, 10.0, 30.0, 2000.0);
        let e = RunoutEngine::new(&dem, 21, 21, 10.0);
        assert!(e.compute(999, 999, 23.0).iter().all(|&v| v == 0));
    }

    #[test]
    #[should_panic(expected = "does not match")]
    fn rejects_mismatched_dimensions() {
        RunoutEngine::new(&[0.0; 10], 4, 4, 10.0);
    }
}
