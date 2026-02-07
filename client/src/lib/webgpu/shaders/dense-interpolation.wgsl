// Pass 2: Dense Interpolation of Sparse Motion Vectors
//
// Takes the sparse block-level motion vectors from Pass 1 and produces
// a full-resolution displacement field via bilinear interpolation between
// block centers.
//
// Dispatch: ceil(imageWidth / 16) x ceil(imageHeight / 16) x 1
// Workgroup: 16 x 16 x 1

struct Params {
  imageWidth:  u32,
  imageHeight: u32,
  blockSize:   u32,
  gridWidth:   u32,  // ceil(imageWidth / blockSize)
  gridHeight:  u32,  // ceil(imageHeight / blockSize)
  _pad0:       u32,
  _pad1:       u32,
  _pad2:       u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> motionVectors: array<f32>;       // sparse (dx,dy) per block
@group(0) @binding(2) var<storage, read_write> displacementField: array<f32>; // dense (dx,dy) per pixel

fn getMotionVector(gx: i32, gy: i32) -> vec2<f32> {
  let cx = clamp(gx, 0, i32(params.gridWidth) - 1);
  let cy = clamp(gy, 0, i32(params.gridHeight) - 1);
  let idx = u32(cy) * params.gridWidth + u32(cx);
  return vec2<f32>(motionVectors[idx * 2u], motionVectors[idx * 2u + 1u]);
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

  let blockSize = f32(params.blockSize);
  let halfBlock = blockSize * 0.5;

  // Continuous block-grid coordinate (block centers are at (gx+0.5)*blockSize)
  let fx = (f32(x) - halfBlock + 0.5) / blockSize;
  let fy = (f32(y) - halfBlock + 0.5) / blockSize;

  // Integer grid coordinates of the 4 surrounding block centers
  let gx0 = i32(floor(fx));
  let gy0 = i32(floor(fy));
  let gx1 = gx0 + 1;
  let gy1 = gy0 + 1;

  // Fractional weights
  let wx = fx - f32(gx0);
  let wy = fy - f32(gy0);

  // Fetch 4 neighbors
  let v00 = getMotionVector(gx0, gy0);
  let v10 = getMotionVector(gx1, gy0);
  let v01 = getMotionVector(gx0, gy1);
  let v11 = getMotionVector(gx1, gy1);

  // Bilinear interpolation
  let top    = mix(v00, v10, wx);
  let bottom = mix(v01, v11, wx);
  let result = mix(top, bottom, wy);

  let pixelIdx = y * params.imageWidth + x;
  displacementField[pixelIdx * 2u]      = result.x;
  displacementField[pixelIdx * 2u + 1u] = result.y;
}
