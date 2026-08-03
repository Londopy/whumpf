// Synthetic attribute tile so the shader can be developed before the pipeline
// produces real tiles. Encodes a cone: slope rises with radius, aspect is the
// bearing from centre, elevation falls with radius.
//
// Same encoding as pipeline/attributes.py.

export function makeTestAttributeTile(size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const c = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy) / c;

      const slope = Math.min(r * 70, 90);

      // atan2(dx, -dy) gives compass bearing: 0 = north (up), clockwise.
      let aspect = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (aspect < 0) aspect += 360;

      const elev = 3200 - r * 1400;

      const i = (y * size + x) * 4;
      img.data[i] = Math.round((slope / 90) * 255);
      img.data[i + 1] = Math.round((aspect / 360) * 255);
      img.data[i + 2] = Math.round((Math.max(elev, 0) / 4000) * 255);
      img.data[i + 3] = r <= 1 ? 255 : 0;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
