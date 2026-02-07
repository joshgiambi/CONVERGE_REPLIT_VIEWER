// Pass 3: Horn-Schunck Optical Flow Refinement
//
// Iterative Jacobi solver that refines the displacement field from Pass 2
// using the Horn-Schunck variational model on the residual (after warping
// the moving image by the coarse displacement field).
//
// Each dispatch is ONE iteration. The orchestrator runs N dispatches,
// ping-ponging between two displacement buffers.
//
// The data term uses image gradients computed from the warped moving image
// and the fixed image. The smoothness term uses the 4-connected Laplacian.
//
// Dispatch: ceil(imageWidth / 16) x ceil(imageHeight / 16) x 1
// Workgroup: 16 x 16 x 1

struct Params {
  imageWidth:  u32,
  imageHeight: u32,
  alpha:       f32,   // smoothness weight (higher = smoother field)
  _pad0:       u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> fixedImage:  array<f32>;
@group(0) @binding(2) var<storage, read> movingImage: array<f32>;
@group(0) @binding(3) var<storage, read> fieldIn:     array<f32>;  // current displacement (dx,dy) per pixel
@group(0) @binding(4) var<storage, read_write> fieldOut: array<f32>; // updated displacement

fn pixelIdx(x: u32, y: u32) -> u32 {
  return y * params.imageWidth + x;
}

fn sampleFixed(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.imageWidth) - 1);
  let cy = clamp(y, 0, i32(params.imageHeight) - 1);
  return fixedImage[u32(cy) * params.imageWidth + u32(cx)];
}

fn sampleMoving(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.imageWidth) - 1);
  let cy = clamp(y, 0, i32(params.imageHeight) - 1);
  return movingImage[u32(cy) * params.imageWidth + u32(cx)];
}

// Bilinear sample of moving image at continuous coordinates
fn sampleMovingBilinear(fx: f32, fy: f32) -> f32 {
  let x0 = i32(floor(fx));
  let y0 = i32(floor(fy));
  let x1 = x0 + 1;
  let y1 = y0 + 1;
  let wx = fx - f32(x0);
  let wy = fy - f32(y0);

  let v00 = sampleMoving(x0, y0);
  let v10 = sampleMoving(x1, y0);
  let v01 = sampleMoving(x0, y1);
  let v11 = sampleMoving(x1, y1);

  return mix(mix(v00, v10, wx), mix(v01, v11, wx), wy);
}

fn getField(x: i32, y: i32) -> vec2<f32> {
  let cx = u32(clamp(x, 0, i32(params.imageWidth) - 1));
  let cy = u32(clamp(y, 0, i32(params.imageHeight) - 1));
  let idx = cy * params.imageWidth + cx;
  return vec2<f32>(fieldIn[idx * 2u], fieldIn[idx * 2u + 1u]);
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

  let ix = i32(x);
  let iy = i32(y);
  let alpha2 = params.alpha * params.alpha;

  // Current displacement at this pixel
  let uv = getField(ix, iy);

  // 4-connected Laplacian (average of neighbors)
  let uL = getField(ix - 1, iy);
  let uR = getField(ix + 1, iy);
  let uU = getField(ix, iy - 1);
  let uD = getField(ix, iy + 1);
  let uvAvg = (uL + uR + uU + uD) * 0.25;

  // Warped position in moving image
  let warpX = f32(x) + uv.x;
  let warpY = f32(y) + uv.y;

  // Image gradients at warped position (central differences on moving image)
  let Ix = (sampleMovingBilinear(warpX + 1.0, warpY) - sampleMovingBilinear(warpX - 1.0, warpY)) * 0.5;
  let Iy = (sampleMovingBilinear(warpX, warpY + 1.0) - sampleMovingBilinear(warpX, warpY - 1.0)) * 0.5;

  // Temporal gradient: difference between warped moving and fixed
  let It = sampleMovingBilinear(warpX, warpY) - sampleFixed(ix, iy);

  // Horn-Schunck update (Jacobi iteration)
  let denom = alpha2 + Ix * Ix + Iy * Iy;
  let crossTerm = Ix * uvAvg.x + Iy * uvAvg.y + It;

  let newU = uvAvg.x - Ix * crossTerm / denom;
  let newV = uvAvg.y - Iy * crossTerm / denom;

  let idx = y * params.imageWidth + x;
  fieldOut[idx * 2u]      = newU;
  fieldOut[idx * 2u + 1u] = newV;
}
