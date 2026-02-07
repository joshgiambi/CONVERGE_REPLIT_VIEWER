/**
 * WebGPU Block Matching + Dense Refinement Pipeline
 *
 * Three-pass deformable registration inspired by video codec motion estimation:
 *   Pass 1 — Coarse block matching (SAD) to find large displacements
 *   Pass 2 — Bilinear interpolation to dense displacement field
 *   Pass 3 — Horn-Schunck iterative refinement for sub-pixel accuracy
 *
 * All computation runs on the GPU via WebGPU compute shaders.
 */

import blockMatchingWGSL from './shaders/block-matching.wgsl?raw';
import denseInterpolationWGSL from './shaders/dense-interpolation.wgsl?raw';
import hornSchunckWGSL from './shaders/horn-schunck.wgsl?raw';

// ── Types ──────────────────────────────────────────────────────────────

export interface BlockMatchingParams {
  /** Block size in pixels for the matching phase (default: 16) */
  blockSize?: number;
  /** Search radius in pixels around each block (default: 32) */
  searchRadius?: number;
  /** Horn-Schunck smoothness weight — higher = smoother field (default: 50) */
  alpha?: number;
  /** Number of Horn-Schunck refinement iterations (default: 40) */
  refinementIterations?: number;
}

export interface DisplacementField {
  /** Dense displacement vectors, interleaved [dx0, dy0, dx1, dy1, ...] */
  data: Float32Array;
  width: number;
  height: number;
}

export interface BlockMatchingResult {
  /** The dense displacement field (dx, dy per pixel) */
  displacementField: DisplacementField;
  /** Timing info for each pass in milliseconds */
  timing: {
    blockMatching: number;
    interpolation: number;
    refinement: number;
    total: number;
    readback: number;
  };
  /** Sparse motion vectors from Pass 1 (for diagnostics) */
  sparseVectors: Float32Array;
  sparseGridWidth: number;
  sparseGridHeight: number;
}

// ── GPU Resource Management ────────────────────────────────────────────

interface GPUResources {
  device: GPUDevice;

  // Pipelines
  blockMatchPipeline: GPUComputePipeline;
  interpolationPipeline: GPUComputePipeline;
  hornSchunckPipeline: GPUComputePipeline;

  // Bind group layouts
  blockMatchLayout: GPUBindGroupLayout;
  interpolationLayout: GPUBindGroupLayout;
  hornSchunckLayout: GPUBindGroupLayout;
}

let gpuResources: GPUResources | null = null;

async function initGPU(): Promise<GPUResources> {
  if (gpuResources) return gpuResources;

  if (!navigator.gpu) {
    throw new Error('WebGPU not supported in this browser');
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('No WebGPU adapter available');
  }

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
    },
  });

  device.lost.then((info) => {
    console.error('WebGPU device lost:', info.message);
    gpuResources = null;
  });

  // ── Pass 1: Block Matching ──

  const blockMatchModule = device.createShaderModule({
    label: 'block-matching',
    code: blockMatchingWGSL,
  });

  const blockMatchLayout = device.createBindGroupLayout({
    label: 'block-match-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const blockMatchPipeline = device.createComputePipeline({
    label: 'block-match-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [blockMatchLayout] }),
    compute: { module: blockMatchModule, entryPoint: 'main' },
  });

  // ── Pass 2: Dense Interpolation ──

  const interpolationModule = device.createShaderModule({
    label: 'dense-interpolation',
    code: denseInterpolationWGSL,
  });

  const interpolationLayout = device.createBindGroupLayout({
    label: 'interpolation-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const interpolationPipeline = device.createComputePipeline({
    label: 'interpolation-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [interpolationLayout] }),
    compute: { module: interpolationModule, entryPoint: 'main' },
  });

  // ── Pass 3: Horn-Schunck ──

  const hornSchunckModule = device.createShaderModule({
    label: 'horn-schunck',
    code: hornSchunckWGSL,
  });

  const hornSchunckLayout = device.createBindGroupLayout({
    label: 'horn-schunck-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const hornSchunckPipeline = device.createComputePipeline({
    label: 'horn-schunck-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [hornSchunckLayout] }),
    compute: { module: hornSchunckModule, entryPoint: 'main' },
  });

  gpuResources = {
    device,
    blockMatchPipeline,
    interpolationPipeline,
    hornSchunckPipeline,
    blockMatchLayout,
    interpolationLayout,
    hornSchunckLayout,
  };

  return gpuResources;
}

// ── Utility ────────────────────────────────────────────────────────────

function createBufferFromData(device: GPUDevice, data: ArrayBuffer, usage: GPUBufferUsageFlags, label: string): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: Math.max(data.byteLength, 4), // WebGPU requires size > 0
    usage,
    mappedAtCreation: true,
  });
  new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data));
  buffer.unmap();
  return buffer;
}

function createEmptyBuffer(device: GPUDevice, byteSize: number, usage: GPUBufferUsageFlags, label: string): GPUBuffer {
  return device.createBuffer({
    label,
    size: Math.max(byteSize, 4),
    usage,
  });
}

/** Normalize a Float32Array to [0, 1] for better SAD matching */
function normalizeImage(data: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = (data[i] - min) / range;
  }
  return out;
}

// ── Main Pipeline ──────────────────────────────────────────────────────

/**
 * Run the full block-matching + dense refinement pipeline on two 2D images.
 *
 * Both images must be the same dimensions. Pixel data is flat Float32Array
 * in row-major order.
 */
export async function computeBlockMatchingDisplacement(
  fixedImageData: Float32Array,
  movingImageData: Float32Array,
  imageWidth: number,
  imageHeight: number,
  params?: BlockMatchingParams,
): Promise<BlockMatchingResult> {
  const blockSize = params?.blockSize ?? 16;
  const searchRadius = params?.searchRadius ?? 32;
  const alpha = params?.alpha ?? 50.0;
  const refinementIterations = params?.refinementIterations ?? 40;

  const gridWidth = Math.ceil(imageWidth / blockSize);
  const gridHeight = Math.ceil(imageHeight / blockSize);
  const numPixels = imageWidth * imageHeight;

  // Normalize images to [0,1] for consistent SAD values
  const fixedNorm = normalizeImage(fixedImageData);
  const movingNorm = normalizeImage(movingImageData);

  const gpu = await initGPU();
  const { device } = gpu;

  const t0 = performance.now();

  // ── Upload images ──

  const fixedBuf = createBufferFromData(
    device, fixedNorm.buffer, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'fixed-image',
  );
  const movingBuf = createBufferFromData(
    device, movingNorm.buffer, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'moving-image',
  );

  // ── Pass 1: Block Matching ──

  const pass1ParamsData = new Uint32Array([
    imageWidth, imageHeight, blockSize, searchRadius, gridWidth, gridHeight,
  ]);
  const pass1ParamsBuf = createBufferFromData(
    device, pass1ParamsData.buffer, GPUBufferUsage.UNIFORM, 'block-match-params',
  );

  const sparseVectorBytes = gridWidth * gridHeight * 2 * 4; // 2 floats per block
  const sparseVectorBuf = createEmptyBuffer(
    device, sparseVectorBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'sparse-vectors',
  );

  const pass1BindGroup = device.createBindGroup({
    layout: gpu.blockMatchLayout,
    entries: [
      { binding: 0, resource: { buffer: pass1ParamsBuf } },
      { binding: 1, resource: { buffer: fixedBuf } },
      { binding: 2, resource: { buffer: movingBuf } },
      { binding: 3, resource: { buffer: sparseVectorBuf } },
    ],
  });

  const t1 = performance.now();

  const encoder1 = device.createCommandEncoder({ label: 'block-match-encoder' });
  const pass1 = encoder1.beginComputePass({ label: 'block-match-pass' });
  pass1.setPipeline(gpu.blockMatchPipeline);
  pass1.setBindGroup(0, pass1BindGroup);
  pass1.dispatchWorkgroups(gridWidth, gridHeight, 1);
  pass1.end();
  device.queue.submit([encoder1.finish()]);
  await device.queue.onSubmittedWorkDone();

  const t2 = performance.now();

  // ── Pass 2: Dense Interpolation ──

  // Params struct has 8 u32 fields (padded to 32 bytes)
  const pass2ParamsData = new Uint32Array([
    imageWidth, imageHeight, blockSize, gridWidth, gridHeight, 0, 0, 0,
  ]);
  const pass2ParamsBuf = createBufferFromData(
    device, pass2ParamsData.buffer, GPUBufferUsage.UNIFORM, 'interpolation-params',
  );

  const denseFieldBytes = numPixels * 2 * 4; // 2 floats per pixel
  const denseFieldBufA = createEmptyBuffer(
    device, denseFieldBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'dense-field-A',
  );

  const pass2BindGroup = device.createBindGroup({
    layout: gpu.interpolationLayout,
    entries: [
      { binding: 0, resource: { buffer: pass2ParamsBuf } },
      { binding: 1, resource: { buffer: sparseVectorBuf } },
      { binding: 2, resource: { buffer: denseFieldBufA } },
    ],
  });

  const encoder2 = device.createCommandEncoder({ label: 'interpolation-encoder' });
  const pass2 = encoder2.beginComputePass({ label: 'interpolation-pass' });
  pass2.setPipeline(gpu.interpolationPipeline);
  pass2.setBindGroup(0, pass2BindGroup);
  pass2.dispatchWorkgroups(
    Math.ceil(imageWidth / 16),
    Math.ceil(imageHeight / 16),
    1,
  );
  pass2.end();
  device.queue.submit([encoder2.finish()]);
  await device.queue.onSubmittedWorkDone();

  const t3 = performance.now();

  // ── Pass 3: Horn-Schunck Refinement (ping-pong) ──

  // Use a Float32Array for the mixed uniform buffer (u32, u32, f32, u32)
  const pass3ParamsF32 = new Float32Array(4);
  const pass3ParamsU32 = new Uint32Array(pass3ParamsF32.buffer);
  pass3ParamsU32[0] = imageWidth;
  pass3ParamsU32[1] = imageHeight;
  pass3ParamsF32[2] = alpha;
  pass3ParamsU32[3] = 0; // padding

  const pass3ParamsBuf = createBufferFromData(
    device, pass3ParamsF32.buffer, GPUBufferUsage.UNIFORM, 'horn-schunck-params',
  );

  // Second displacement buffer for ping-pong
  const denseFieldBufB = createEmptyBuffer(
    device, denseFieldBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'dense-field-B',
  );

  const hsWorkgroupsX = Math.ceil(imageWidth / 16);
  const hsWorkgroupsY = Math.ceil(imageHeight / 16);

  // Create both bind groups for ping-pong
  const hsBindGroupAtoB = device.createBindGroup({
    layout: gpu.hornSchunckLayout,
    entries: [
      { binding: 0, resource: { buffer: pass3ParamsBuf } },
      { binding: 1, resource: { buffer: fixedBuf } },
      { binding: 2, resource: { buffer: movingBuf } },
      { binding: 3, resource: { buffer: denseFieldBufA } },  // read from A
      { binding: 4, resource: { buffer: denseFieldBufB } },  // write to B
    ],
  });

  const hsBindGroupBtoA = device.createBindGroup({
    layout: gpu.hornSchunckLayout,
    entries: [
      { binding: 0, resource: { buffer: pass3ParamsBuf } },
      { binding: 1, resource: { buffer: fixedBuf } },
      { binding: 2, resource: { buffer: movingBuf } },
      { binding: 3, resource: { buffer: denseFieldBufB } },  // read from B
      { binding: 4, resource: { buffer: denseFieldBufA } },  // write to A
    ],
  });

  // Run iterations — batch multiple iterations per command encoder for throughput
  const batchSize = 10;
  for (let start = 0; start < refinementIterations; start += batchSize) {
    const end = Math.min(start + batchSize, refinementIterations);
    const encoder3 = device.createCommandEncoder({ label: `horn-schunck-batch-${start}` });
    for (let i = start; i < end; i++) {
      const pass3 = encoder3.beginComputePass({ label: `horn-schunck-iter-${i}` });
      pass3.setPipeline(gpu.hornSchunckPipeline);
      pass3.setBindGroup(0, (i % 2 === 0) ? hsBindGroupAtoB : hsBindGroupBtoA);
      pass3.dispatchWorkgroups(hsWorkgroupsX, hsWorkgroupsY, 1);
      pass3.end();
    }
    device.queue.submit([encoder3.finish()]);
  }
  await device.queue.onSubmittedWorkDone();

  const t4 = performance.now();

  // ── Read back results ──

  // Determine which buffer has the final result
  const finalFieldBuf = (refinementIterations % 2 === 0) ? denseFieldBufA : denseFieldBufB;

  // Dense field readback
  const readbackBuf = createEmptyBuffer(
    device, denseFieldBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, 'dense-field-readback',
  );
  const sparseReadbackBuf = createEmptyBuffer(
    device, sparseVectorBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, 'sparse-readback',
  );

  const readEncoder = device.createCommandEncoder({ label: 'readback-encoder' });
  readEncoder.copyBufferToBuffer(finalFieldBuf, 0, readbackBuf, 0, denseFieldBytes);
  readEncoder.copyBufferToBuffer(sparseVectorBuf, 0, sparseReadbackBuf, 0, sparseVectorBytes);
  device.queue.submit([readEncoder.finish()]);

  await readbackBuf.mapAsync(GPUMapMode.READ);
  const denseResult = new Float32Array(readbackBuf.getMappedRange().slice(0));
  readbackBuf.unmap();

  await sparseReadbackBuf.mapAsync(GPUMapMode.READ);
  const sparseResult = new Float32Array(sparseReadbackBuf.getMappedRange().slice(0));
  sparseReadbackBuf.unmap();

  const t5 = performance.now();

  // ── Cleanup GPU buffers ──

  fixedBuf.destroy();
  movingBuf.destroy();
  pass1ParamsBuf.destroy();
  sparseVectorBuf.destroy();
  pass2ParamsBuf.destroy();
  denseFieldBufA.destroy();
  denseFieldBufB.destroy();
  pass3ParamsBuf.destroy();
  readbackBuf.destroy();
  sparseReadbackBuf.destroy();

  return {
    displacementField: {
      data: denseResult,
      width: imageWidth,
      height: imageHeight,
    },
    timing: {
      blockMatching: t2 - t1,
      interpolation: t3 - t2,
      refinement: t4 - t3,
      readback: t5 - t4,
      total: t5 - t0,
    },
    sparseVectors: sparseResult,
    sparseGridWidth: gridWidth,
    sparseGridHeight: gridHeight,
  };
}

/**
 * Apply a displacement field to warp an image (CPU fallback for display).
 * Uses bilinear interpolation.
 */
export function applyDisplacementField(
  sourceImage: Float32Array,
  field: DisplacementField,
): Float32Array {
  const { width, height, data: fieldData } = field;
  const output = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const dx = fieldData[idx * 2];
      const dy = fieldData[idx * 2 + 1];

      // Source position in moving image
      const sx = x + dx;
      const sy = y + dy;

      // Bilinear interpolation
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const wx = sx - x0;
      const wy = sy - y0;

      const cx0 = Math.max(0, Math.min(width - 1, x0));
      const cx1 = Math.max(0, Math.min(width - 1, x1));
      const cy0 = Math.max(0, Math.min(height - 1, y0));
      const cy1 = Math.max(0, Math.min(height - 1, y1));

      const v00 = sourceImage[cy0 * width + cx0];
      const v10 = sourceImage[cy0 * width + cx1];
      const v01 = sourceImage[cy1 * width + cx0];
      const v11 = sourceImage[cy1 * width + cx1];

      output[idx] =
        v00 * (1 - wx) * (1 - wy) +
        v10 * wx * (1 - wy) +
        v01 * (1 - wx) * wy +
        v11 * wx * wy;
    }
  }

  return output;
}

/**
 * Compute displacement field magnitude statistics for diagnostics.
 */
export function displacementFieldStats(field: DisplacementField): {
  meanMagnitude: number;
  maxMagnitude: number;
  medianMagnitude: number;
  percentile95: number;
} {
  const { data, width, height } = field;
  const magnitudes: number[] = [];

  for (let i = 0; i < width * height; i++) {
    const dx = data[i * 2];
    const dy = data[i * 2 + 1];
    magnitudes.push(Math.sqrt(dx * dx + dy * dy));
  }

  magnitudes.sort((a, b) => a - b);
  const n = magnitudes.length;

  return {
    meanMagnitude: magnitudes.reduce((s, v) => s + v, 0) / n,
    maxMagnitude: magnitudes[n - 1],
    medianMagnitude: magnitudes[Math.floor(n / 2)],
    percentile95: magnitudes[Math.floor(n * 0.95)],
  };
}

/**
 * Check if WebGPU is available in the current browser.
 */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/**
 * Release cached GPU resources. Call when the module is no longer needed.
 */
export function releaseGPUResources(): void {
  if (gpuResources) {
    gpuResources.device.destroy();
    gpuResources = null;
  }
}
