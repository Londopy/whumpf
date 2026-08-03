import * as Cesium from "cesium";

// Decoding here must match pipeline/attributes.py::unpack. Texel components
// arrive normalised to 0..1, so multiply by the range rather than dividing by
// the packing scale.
const FRAGMENT_SHADER = `
uniform sampler2D u_attr;
uniform int   u_mode;
uniform int   u_aspectMask;
uniform float u_slopeMin;
uniform float u_slopeMax;
uniform float u_elevMin;
uniform float u_elevMax;
uniform vec3  u_dangerColor;
uniform float u_opacity;

// Standard avalanche slope-angle ramp.
vec3 slopeRamp(float s) {
  if (s < 27.0) return vec3(0.0);
  if (s < 30.0) return vec3(0.949, 0.882, 0.298);
  if (s < 35.0) return vec3(0.949, 0.639, 0.255);
  if (s < 46.0) return vec3(0.886, 0.282, 0.239);
  if (s < 51.0) return vec3(0.561, 0.137, 0.125);
  return vec3(0.482, 0.306, 0.659);
}

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  if (u_mode == 0) return m;

  vec4 texel = texture(u_attr, materialInput.st);
  if (texel.a < 0.5) return m;

  float slope  = texel.r * 90.0;
  float aspect = texel.g * 360.0;
  float elev   = texel.b * 4000.0;

  if (u_mode == 1) {
    vec3 c = slopeRamp(slope);
    if (c == vec3(0.0)) return m;
    m.diffuse = c;
    m.alpha = u_opacity;
    return m;
  }

  // Modes 2 and 3 share the filter; only the uniform source differs.
  int octant = int(floor(mod(aspect + 22.5, 360.0) / 45.0));
  bool aspectHit = (u_aspectMask & (1 << octant)) != 0;

  bool hit = aspectHit
          && slope >= u_slopeMin && slope <= u_slopeMax
          && elev  >= u_elevMin  && elev  <= u_elevMax;

  if (!hit) return m;

  m.diffuse = u_dangerColor;
  m.alpha = u_opacity;
  return m;
}
`;

const DEFAULTS = {
  u_mode: 1,
  u_aspectMask: 0,
  u_slopeMin: 30.0,
  u_slopeMax: 50.0,
  u_elevMin: 0.0,
  u_elevMax: 4000.0,
  u_dangerColor: new Cesium.Cartesian3(0.97, 0.57, 0.09),
  u_opacity: 0.65,
};

export function createAttributeMaterial(attrTextureUrl) {
  return new Cesium.Material({
    fabric: {
      type: "WhumpfAttributes",
      uniforms: { ...DEFAULTS, u_attr: attrTextureUrl },
      source: FRAGMENT_SHADER,
    },
    translucent: true,
  });
}

export function setUniforms(material, values) {
  for (const [k, v] of Object.entries(values)) {
    if (k === "u_dangerColor" && Array.isArray(v)) {
      material.uniforms[k] = new Cesium.Cartesian3(...v);
    } else {
      material.uniforms[k] = v;
    }
  }
}

export function hexToVec3(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
