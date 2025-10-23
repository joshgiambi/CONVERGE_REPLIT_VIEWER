# SegVol Integration Setup Guide

This guide explains how to set up and use the SegVol AI-powered slice prediction feature.

## Overview

SegVol is a universal volumetric medical image segmentation model that provides AI-powered next-slice prediction. It's integrated as an **optional** enhancement to the existing geometric prediction system.

**Model Details:**
- **Paper**: [SegVol: Universal and Interactive Volumetric Medical Image Segmentation](https://arxiv.org/abs/2311.13385)
- **GitHub**: https://github.com/BAAI-DCAI/SegVol
- **Model Size**: 181M parameters (~700MB)
- **Inference Speed**: 500ms - 2s per slice
- **GPU Memory**: ~800MB
- **Accuracy**: 83% average Dice score (14.76% better than nnU-Net on hard cases)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Browser)                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  contour-prediction.ts                                │  │
│  │  - Mode selector: 'geometric' | 'segvol'              │  │
│  │  - Fallback: SegVol → Geometric on failure            │  │
│  └─────────────────────┬─────────────────────────────────┘  │
│                        │                                      │
│  ┌─────────────────────▼─────────────────────────────────┐  │
│  │  segvol-client.ts (API wrapper)                       │  │
│  └─────────────────────┬─────────────────────────────────┘  │
└────────────────────────┼─────────────────────────────────────┘
                         │ HTTP/JSON
┌────────────────────────▼─────────────────────────────────────┐
│                   Express Server (Node.js)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  segvol-api.ts                                        │  │
│  │  - /api/segvol/health                                 │  │
│  │  - /api/segvol/predict                                │  │
│  │  - /api/segvol/predict-batch                          │  │
│  └─────────────────────┬─────────────────────────────────┘  │
└────────────────────────┼─────────────────────────────────────┘
                         │ HTTP/JSON
┌────────────────────────▼─────────────────────────────────────┐
│              Python SegVol Service (Flask)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  segvol_service.py                                    │  │
│  │  - Loads SegVol model (PyTorch)                       │  │
│  │  - Handles DICOM slice data                           │  │
│  │  - Returns predicted contours                         │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Python 3.8+**
- **CUDA-capable GPU** (recommended) or CPU (slower)
- **4GB+ GPU VRAM** or **8GB+ system RAM** for CPU mode
- **10GB+ disk space** (for model weights and dependencies)

## Setup Instructions

### 1. Install Python Dependencies

```bash
cd server/segvol

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # On Linux/Mac
# OR
venv\Scripts\activate  # On Windows

# Install dependencies
pip install -r requirements.txt

# Clone SegVol repository
git clone https://github.com/BAAI-DCAI/SegVol.git
cd SegVol
pip install -e .
cd ..
```

### 2. Download Model Weights

SegVol will automatically download weights from HuggingFace on first run, or manually download:

```bash
# Option 1: Automatic (recommended)
# Model downloads automatically on first inference

# Option 2: Manual download
# Visit: https://huggingface.co/BAAI/SegVol
# Download model files to: server/segvol/SegVol/model_weights/
```

### 3. Configure Environment Variables

Add to your `.env` file:

```bash
# SegVol Service Configuration
SEGVOL_SERVICE_URL=http://127.0.0.1:5001
SEGVOL_TIMEOUT=30000  # 30 seconds
```

### 4. Start SegVol Service

```bash
cd server/segvol
source venv/bin/activate

# For GPU (recommended)
python segvol_service.py --port 5001 --device cuda

# For CPU only (slower)
python segvol_service.py --port 5001 --device cpu
```

**Expected output:**
```
INFO - Initializing SegVol on device: cuda
INFO - SegVol model loaded successfully
INFO - Starting SegVol service on 127.0.0.1:5001
```

### 5. Start Main Application

In a separate terminal:

```bash
# From project root
npm run dev
```

### 6. Verify Integration

Open browser console and check:

```javascript
// Check if SegVol is available
fetch('/api/segvol/health')
  .then(r => r.json())
  .then(console.log);

// Expected response:
{
  "status": "ok",
  "segvol_service": {
    "status": "healthy",
    "model_loaded": true,
    "device": "cuda"
  },
  "segvol_available": true,
  "service_url": "http://127.0.0.1:5001"
}
```

## Usage

### In Code

```typescript
import { predictNextSliceContour } from './lib/contour-prediction';

// Use SegVol prediction
const result = await predictNextSliceContour({
  currentContour: [x1, y1, z1, x2, y2, z2, ...],
  currentSlicePosition: 50.0,
  targetSlicePosition: 51.0,
  predictionMode: 'segvol',  // 👈 Use SegVol
  imageData: {
    currentSlice: currentSliceImageData,
    targetSlice: targetSliceImageData,
  },
  coordinateTransforms: {
    worldToPixel: (x, y) => [px, py],
    pixelToWorld: (px, py) => [x, y],
  },
  enableImageRefinement: true,
});
```

### Prediction Modes

| Mode | Description | Speed | Accuracy | Requirements |
|------|-------------|-------|----------|--------------|
| `'simple'` | Basic geometric scaling | <5ms | Low | None |
| `'adaptive'` | Shape-aware deformation | 5-15ms | Medium | 1+ reference contour |
| `'trend-based'` | Trend extrapolation | 10-20ms | High | 2+ reference contours |
| **`'segvol'`** | **AI-powered prediction** | **500-2000ms** | **Highest** | **SegVol service + image data** |

### Automatic Fallback

If SegVol fails (service down, timeout, error), the system **automatically falls back** to geometric prediction:

```typescript
// SegVol attempt → falls back to 'adaptive' on failure
predictionMode: 'segvol'
// ✓ Tries SegVol first
// ✓ Falls back to geometric if SegVol unavailable
// ✓ User never sees errors
```

## Configuration Options

### SegVol Service Arguments

```bash
python segvol_service.py \
  --port 5001 \              # Service port
  --host 127.0.0.1 \         # Bind address
  --device cuda \            # 'cuda' or 'cpu'
  --model-path BAAI/SegVol   # HuggingFace model or local path
```

### Environment Variables

```bash
# Backend service URL
SEGVOL_SERVICE_URL=http://127.0.0.1:5001

# Timeout for predictions (milliseconds)
SEGVOL_TIMEOUT=30000

# Batch prediction timeout (2x single)
SEGVOL_BATCH_TIMEOUT=60000
```

## Performance Optimization

### GPU Mode (Recommended)

- **Inference time**: 500-800ms
- **GPU memory**: ~800MB
- **Recommended**: NVIDIA GPU with 2GB+ VRAM

### CPU Mode (Fallback)

- **Inference time**: 1500-2000ms
- **RAM usage**: ~2-3GB
- **Use when**: No GPU available

### Batch Prediction

For predicting multiple slices at once:

```typescript
const results = await segvolClient.predictBatch(
  referenceContour,
  referenceSliceData,
  referenceSlicePosition,
  imageShape,
  [
    { slice_data: targetData1, slice_position: 51 },
    { slice_data: targetData2, slice_position: 52 },
    { slice_data: targetData3, slice_position: 53 },
  ],
  spacing
);
```

## Troubleshooting

### SegVol Service Not Starting

**Error**: `Failed to load SegVol model`

**Solutions**:
1. Check Python dependencies: `pip list | grep -E "torch|monai"`
2. Verify SegVol repo cloned: `ls server/segvol/SegVol`
3. Check GPU availability: `python -c "import torch; print(torch.cuda.is_available())"`

### Health Check Fails

**Error**: `503 Service Unavailable`

**Solutions**:
1. Verify SegVol service is running: `ps aux | grep segvol_service`
2. Check port 5001 is not in use: `lsof -i :5001`
3. Review service logs for errors

### Predictions Timeout

**Error**: `SegVol prediction timed out`

**Solutions**:
1. Increase timeout in `.env`: `SEGVOL_TIMEOUT=60000`
2. Use CPU mode (slower but more stable)
3. Reduce image resolution if possible

### Out of Memory (GPU)

**Error**: `CUDA out of memory`

**Solutions**:
1. Close other GPU applications
2. Switch to CPU mode: `--device cpu`
3. Reduce batch size if using batch prediction

## Comparison: SegVol vs Geometric Prediction

| Feature | Geometric | SegVol |
|---------|-----------|--------|
| **Speed** | 5-20ms ⚡ | 500-2000ms |
| **Accuracy** | Good | Excellent |
| **Complex anatomy** | Moderate | Excellent |
| **Infrastructure** | None | GPU server |
| **Offline mode** | ✓ Yes | ✗ No |
| **Works without images** | ✓ Yes | ✗ No |
| **Fallback** | N/A | → Geometric |

## Production Deployment

### Docker Deployment (Recommended)

```dockerfile
# Dockerfile.segvol
FROM nvidia/cuda:11.8.0-runtime-ubuntu22.04

WORKDIR /app
COPY server/segvol/requirements.txt .
RUN pip install -r requirements.txt

COPY server/segvol/ .
RUN git clone https://github.com/BAAI-DCAI/SegVol.git && \
    cd SegVol && pip install -e .

EXPOSE 5001
CMD ["python", "segvol_service.py", "--port", "5001", "--device", "cuda"]
```

```bash
docker build -f Dockerfile.segvol -t segvol-service .
docker run --gpus all -p 5001:5001 segvol-service
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: segvol-service
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: segvol
        image: segvol-service:latest
        resources:
          limits:
            nvidia.com/gpu: 1
            memory: "4Gi"
        env:
        - name: CUDA_VISIBLE_DEVICES
          value: "0"
```

### Load Balancing

For high-volume deployments:
1. Run multiple SegVol service instances
2. Use NGINX/HAProxy for load balancing
3. Configure `SEGVOL_SERVICE_URL` to load balancer

## API Reference

### Health Check

```bash
GET /api/segvol/health
```

**Response**:
```json
{
  "status": "ok",
  "segvol_service": {
    "status": "healthy",
    "model_loaded": true,
    "device": "cuda"
  },
  "segvol_available": true
}
```

### Predict Single Slice

```bash
POST /api/segvol/predict
Content-Type: application/json

{
  "reference_contour": [[x1,y1], [x2,y2], ...],
  "reference_slice_data": [pixel1, pixel2, ...],
  "target_slice_data": [pixel1, pixel2, ...],
  "reference_slice_position": 50.0,
  "target_slice_position": 51.0,
  "image_shape": [512, 512],
  "spacing": [1.0, 1.0, 2.5]
}
```

**Response**:
```json
{
  "predicted_contour": [[x1,y1], [x2,y2], ...],
  "confidence": 0.87,
  "method": "segvol_volumetric",
  "metadata": {
    "num_points": 64,
    "slice_distance": 1.0,
    "interpolated_slices": 1
  }
}
```

### Batch Prediction

```bash
POST /api/segvol/predict-batch
```

See code examples above for request format.

## Support

- **Issues**: https://github.com/BAAI-DCAI/SegVol/issues
- **Paper**: https://arxiv.org/abs/2311.13385
- **HuggingFace**: https://huggingface.co/BAAI/SegVol

## License

SegVol is released under its original license. Check the [SegVol repository](https://github.com/BAAI-DCAI/SegVol) for details.
