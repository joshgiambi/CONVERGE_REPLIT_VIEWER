// Apply displacement field to warp an image on GPU via bilinear interpolation.
//
// Dispatch: ceil(imageWidth / 16) x ceil(imageHeight / 16) x 1
// Workgroup: 16 x 16 x 1

struct Params {
  imageWidth:  u32,
  imageHeight: u32,
  _pad0:       u32,
  _pad1:       u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> sourceImage: array<f32>;
@group(0) @binding(2) var<storage, read> displacementField: array<f32>; // interleaved (dx, dy) per pixel
@group(0) @binding(3) var<storage, read_write> outputImage: array<f32>;

fn sampleBilinear(fx: f32, fy: f32) -> f32 {
  let w = i32(params.imageWidth);
  let h = i32(params.imageHeight);
  let x0 = i32(floor(fx));
  let y0 = i32(floor(fy));
  let x1 = x0 + 1;
  let y1 = y0 + 1;

  let cx0 = clamp(x0, 0, w - 1);
  let cx1 = clamp(x1, 0, w - 1);
  let cy0 = clamp(y0, 0, h - 1);
  let cy1 = clamp(y1, 0, h - 1);

  let wx = fx - f32(x0);
  let wy = fy - f32(y0);

  let v00 = sourceImage[u32(cy0) * params.imageWidth + u32(cx0)];
  let v10 = sourceImage[u32(cy0) * params.imageWidth + u32(cx1)];
  let v01 = sourceImage[u32(cy1) * params.imageWidth + u32(cx0)];
  let v11 = sourceImage[u32(cy1) * params.imageWidth + u32(cx1)];

  return mix(mix(v00, v10, wx), mix(v01, v11, wx), wy);
}

@compute @workgroup_size(16, 16, 1)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.imageWidth || y >= params.imageHeight) {
    return;
  }

  let idx = y * params.imageWidth + x;
  let dx = displacementField[idx * 2u];
  let dy = displacementField[idx * 2u + 1u];

  let srcX = f32(x) + dx;
  let srcY = f32(y) + dy;

  outputImage[idx] = sampleBilinear(srcX, srcY);
}
