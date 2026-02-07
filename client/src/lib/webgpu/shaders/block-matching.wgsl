// Pass 1: Coarse Block Matching via Sum of Absolute Differences (SAD)
//
// Each workgroup handles one block in the fixed image and searches a
// (2 * searchRadius + 1)^2 neighborhood in the moving image for the
// candidate offset that minimizes SAD. The best motion vector (dx, dy)
// is written to a sparse grid.
//
// Dispatch: ceil(imageWidth / blockSize) x ceil(imageHeight / blockSize) x 1
// Workgroup: blockSize x blockSize x 1  (one thread per pixel in the block)

struct Params {
  imageWidth:    u32,
  imageHeight:   u32,
  blockSize:     u32,
  searchRadius:  u32,
  gridWidth:     u32,  // ceil(imageWidth / blockSize)
  gridHeight:    u32,  // ceil(imageHeight / blockSize)
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> fixedImage:  array<f32>;
@group(0) @binding(2) var<storage, read> movingImage: array<f32>;
@group(0) @binding(3) var<storage, read_write> motionVectors: array<f32>; // 2 floats per block (dx, dy)

// Shared memory: each thread contributes its per-candidate |diff| here.
// Max workgroup size 16x16 = 256 threads.
var<workgroup> sadAccum: array<atomic<u32>, 1>;
var<workgroup> localSAD: array<f32, 256>;

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

@compute @workgroup_size(16, 16, 1)
fn main(
  @builtin(workgroup_id)         wgId:    vec3<u32>,
  @builtin(local_invocation_id)  localId: vec3<u32>,
  @builtin(local_invocation_index) localIdx: u32,
) {
  let blockSize = params.blockSize;
  let searchRadius = i32(params.searchRadius);

  // Block origin in image coordinates
  let blockX = i32(wgId.x * blockSize);
  let blockY = i32(wgId.y * blockSize);

  // This thread's pixel within the block
  let px = i32(localId.x);
  let py = i32(localId.y);
  let inBlock = (u32(px) < blockSize) && (u32(py) < blockSize);

  // Pixel coordinates in the fixed image
  let fixX = blockX + px;
  let fixY = blockY + py;

  // Pre-fetch the fixed pixel value for this thread
  var fixedVal: f32 = 0.0;
  if (inBlock) {
    fixedVal = sampleFixed(fixX, fixY);
  }

  // Exhaustive search over candidate offsets
  var bestSAD: f32 = 1e20;
  var bestDx: i32 = 0;
  var bestDy: i32 = 0;

  // We iterate over all candidate offsets. Each thread computes its own
  // |fixed - moving| difference and we reduce across the workgroup.
  // For simplicity and correctness on all GPUs, we use a sequential
  // reduction pattern where thread 0 accumulates.
  for (var dy: i32 = -searchRadius; dy <= searchRadius; dy = dy + 1) {
    for (var dx: i32 = -searchRadius; dx <= searchRadius; dx = dx + 1) {
      // Each thread computes its pixel's absolute difference
      var diff: f32 = 0.0;
      if (inBlock) {
        let movX = fixX + dx;
        let movY = fixY + dy;
        let movingVal = sampleMoving(movX, movY);
        diff = abs(fixedVal - movingVal);
      }

      // Store to shared memory
      localSAD[localIdx] = diff;
      workgroupBarrier();

      // Thread 0 sums all contributions
      if (localIdx == 0u) {
        var totalSAD: f32 = 0.0;
        let numThreads = blockSize * blockSize;
        for (var i: u32 = 0u; i < numThreads; i = i + 1u) {
          totalSAD = totalSAD + localSAD[i];
        }
        if (totalSAD < bestSAD) {
          bestSAD = totalSAD;
          bestDx = dx;
          bestDy = dy;
        }
      }
      workgroupBarrier();
    }
  }

  // Thread 0 writes the result
  if (localIdx == 0u) {
    let gridIdx = wgId.y * params.gridWidth + wgId.x;
    motionVectors[gridIdx * 2u]      = f32(bestDx);
    motionVectors[gridIdx * 2u + 1u] = f32(bestDy);
  }
}
