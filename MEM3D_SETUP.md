# Mem3D Integration Setup Guide

This guide explains how to set up and use the Mem3D memory-augmented AI prediction feature.

## Overview

Mem3D (Volumetric Memory Network) is a memory-augmented network designed specifically for **interactive slice-by-slice medical image segmentation**. It's integrated as the **primary AI prediction option** and is better suited for our workflow than SegVol.

**Why Mem3D is the Recommended AI Option:**
- **Memory-Augmented**: Learns from previously annotated slices
- **Interactive Workflow**: Designed for slice-by-slice annotation (matches our use case)
- **Faster**: ~200ms inference vs SegVol's ~1s
- **Quality Assessment**: Built-in quality scoring for predictions
- **Slice Recommendation**: Suggests which slices to annotate next
- **Award-Winning**: Medical Image Analysis (MedIA) Best Paper Award 2022

**Model Details:**
- **Paper**: [Volumetric Memory Network for Interactive Medical Image Segmentation](https://www.sciencedirect.com/science/article/pii/S1361841522001049)
- **GitHub**: https://github.com/lingorX/Mem3D (mirror) or https://github.com/0liliulei/Mem3D (original)
- **Authors**: Tianfei Zhou et al., Medical Image Analysis 2022
- **Inference Speed**: 200-500ms per slice (faster than SegVol)
- **GPU Memory**: ~500MB
- **Memory Storage**: Keeps last 10 annotated slices in memory

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Browser)                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  contour-prediction.ts                                │  │
│  │  - Modes: 'geometric' | 'mem3d' | 'segvol'            │  │
│  │  - Mem3D: Primary AI (default for 'smart' mode)      │  │
│  │  - Fallback: Mem3D → Geometric on failure            │  │
│  └─────────────────────┬─────────────────────────────────┘  │
│                        │                                      │
│  ┌─────────────────────▼─────────────────────────────────┐  │
│  │  mem3d-client.ts (API wrapper)                        │  │
│  │  - predictWithMemory()                                │  │
│  │  - recommendNextSlice()                               │  │
│  │  - clearMemory()                                      │  │
│  └─────────────────────┬─────────────────────────────────┘  │
└────────────────────────┼─────────────────────────────────────┘
                         │ HTTP/JSON
┌────────────────────────▼─────────────────────────────────────┐
│                   Express Server (Node.js)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  mem3d-api.ts                                         │  │
│  │  - /api/mem3d/health                                  │  │
│  │  - /api/mem3d/predict                                 │  │
│  │  - /api/mem3d/recommend-slice                         │  │
│  │  - /api/mem3d/clear-memory                            │  │
│  └─────────────────────┬─────────────────────────────────┘  │
└────────────────────────┼─────────────────────────────────────┘
                         │ HTTP/JSON
┌────────────────────────▼─────────────────────────────────────┐
│              Python Mem3D Service (Flask)                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  mem3d_service.py                                     │  │
│  │  - Loads Mem3D model (PyTorch)                        │  │
│  │  - Manages slice memory (OrderedDict)                 │  │
│  │  - Quality assessment & recommendations               │  │
│  │  - Returns predicted masks + quality scores           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Python 3.8+**
- **CUDA-capable GPU** (recommended) or CPU (slower)
- **2GB+ GPU VRAM** or **4GB+ system RAM** for CPU mode
- **5GB+ disk space** (for model weights and dependencies)

## Setup Instructions

### 1. Install Python Dependencies

```bash
cd server/mem3d

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate  # On Linux/Mac
# OR
venv\Scripts\activate  # On Windows

# Install dependencies
pip install -r requirements.txt
```

### 2. Clone Mem3D Repository

The Mem3D model code needs to be cloned:

```bash
cd server/mem3d

# Clone the repository (try main repo first)
git clone https://github.com/0liliulei/Mem3D.git

# If main repo is unavailable, use mirror:
# git clone https://github.com/lingorX/Mem3D.git

# Install any additional dependencies from Mem3D repo
cd Mem3D
if [ -f requirements.txt ]; then
    pip install -r requirements.txt
fi
cd ..
```

Alternatively, use the provided setup script:

```bash
cd server/mem3d
chmod +x setup.sh
./setup.sh
```

### 3. Download Model Weights (Optional)

Mem3D model weights can be:
- **Auto-downloaded** on first inference (recommended)
- **Manually downloaded** from the Mem3D repository releases

```bash
# Option 1: Automatic (recommended)
# Weights will download automatically on first prediction

# Option 2: Manual download
# Visit: https://github.com/0liliulei/Mem3D/releases
# Download model checkpoint to: server/mem3d/model_weights/
```

### 4. Configure Environment Variables

Add to your `.env` file:

```bash
# Mem3D Service Configuration
MEM3D_SERVICE_URL=http://127.0.0.1:5002
MEM3D_TIMEOUT=30000
```

### 5. Start the Mem3D Service

**For GPU (recommended):**
```bash
cd server/mem3d
source venv/bin/activate
python mem3d_service.py --port 5002 --device cuda
```

**For CPU (slower):**
```bash
cd server/mem3d
source venv/bin/activate
python mem3d_service.py --port 5002 --device cpu
```

**Using the start script:**
```bash
cd server/mem3d
chmod +x start-service.sh
./start-service.sh
```

The service will start on `http://127.0.0.1:5002` and listen for predictions.

### 6. Start the Main Application

In a separate terminal:

```bash
# Install dependencies (if not done)
npm install

# Start the application
npm run dev
```

The app will start on `http://localhost:3000`.

## Verification

### 1. Check Mem3D Service Health

```bash
curl http://127.0.0.1:5002/health
```

Expected response:
```json
{
  "status": "healthy",
  "model_loaded": true,
  "device": "cuda",
  "memory_size": 0
}
```

### 2. Test via Main API

```bash
curl http://localhost:3000/api/mem3d/health
```

Expected response:
```json
{
  "status": "ok",
  "mem3d_service": {
    "status": "healthy",
    "model_loaded": true,
    "device": "cuda",
    "memory_size": 0
  },
  "mem3d_available": true,
  "service_url": "http://127.0.0.1:5002"
}
```

### 3. Test in UI

1. Open the app at `http://localhost:3000`
2. Load a DICOM series
3. Select a structure and activate the Brush tool
4. Enable the prediction toggle (Sparkles icon)
5. Open the prediction mode dropdown
6. You should see **Mem3D** option with a Brain icon
7. Select Mem3D mode
8. Draw a contour on one slice
9. Navigate to the next slice - you should see an AI prediction appear

## Usage

### Prediction Modes

The UI offers 5 prediction modes:

1. **Fast** (~10ms) - Geometric interpolation
2. **Balanced** (~15ms) - Trend-based with history (DEFAULT)
3. **Mem3D** (~200ms) - Memory-augmented AI ⭐ **PRIMARY AI**
4. **SegVol** (~1s) - Volumetric AI (advanced/backup)
5. **Smart** (Auto) - Automatically selects Mem3D with fallback

### How Mem3D Works

1. **Memory Building**: As you annotate slices, Mem3D stores them in memory (last 10 slices)
2. **Context-Aware Prediction**: When predicting a new slice, Mem3D uses the 3 nearest slices from memory
3. **Quality Assessment**: Each prediction includes a quality score (0-1)
4. **Slice Recommendation**: Mem3D can suggest which slice to annotate next for optimal coverage

### Memory Management

- **Automatic**: Memory is managed automatically (FIFO with 10-slice limit)
- **Persistence**: Memory persists throughout the session
- **Clear**: Memory clears when switching structures
- **Manual Clear**: Can be cleared via API if needed

### Next-Slice Recommendations (Future Feature)

Mem3D includes a slice recommendation API:

```bash
curl -X POST http://localhost:3000/api/mem3d/recommend-slice \
  -H "Content-Type: application/json" \
  -d '{
    "current_position": 50.0,
    "direction": "both"
  }'
```

This feature will be integrated into the UI to suggest optimal slices for annotation.

## Performance Tips

### GPU Acceleration
- **CUDA**: 200-300ms per prediction
- **CPU**: 800-1500ms per prediction
- **Recommendation**: Use GPU for real-time feel

### Memory Optimization
- Mem3D uses ~500MB GPU memory (vs SegVol's ~800MB)
- Can run alongside SegVol if needed
- Fallback to geometric prediction is seamless if Mem3D fails

### Workflow Tips
1. Start with **Balanced** mode for first few slices (fast, builds history)
2. Switch to **Mem3D** once you have 2-3 annotated slices
3. Use **Smart** mode to automatically select the best method
4. Mem3D quality improves as you add more reference slices

## Troubleshooting

### Service Won't Start

**Check Python version:**
```bash
python3 --version  # Should be 3.8+
```

**Check PyTorch installation:**
```bash
python3 -c "import torch; print(torch.__version__)"
```

**Check CUDA availability:**
```bash
python3 -c "import torch; print(torch.cuda.is_available())"
```

### Predictions Are Slow

- Check if running on CPU (switch to GPU)
- Reduce image resolution if needed
- Use **Fast** or **Balanced** mode for quick annotations
- Mem3D is still 5x faster than SegVol

### "Model Not Loaded" Error

- Ensure Mem3D repository is cloned in `server/mem3d/Mem3D/`
- Check model weights are accessible
- Restart the service with `--device cpu` to test without GPU

### Port Already in Use

If port 5002 is taken:

```bash
# Find process using port
lsof -i :5002

# Kill it or use different port
python mem3d_service.py --port 5003

# Update .env
MEM3D_SERVICE_URL=http://127.0.0.1:5003
```

### Mem3D Offline in UI

- Verify service is running: `curl http://127.0.0.1:5002/health`
- Check `.env` has correct `MEM3D_SERVICE_URL`
- Check browser console for CORS or network errors
- Restart both Mem3D service and main app

## Comparison: Mem3D vs SegVol

| Feature | Mem3D ⭐ | SegVol |
|---------|---------|--------|
| **Use Case** | Interactive slice-by-slice | Volumetric segmentation |
| **Speed** | ~200ms | ~1s |
| **Memory** | Uses past slices | One-shot prediction |
| **Quality Score** | ✅ Built-in | ❌ No |
| **Slice Recommendation** | ✅ Built-in | ❌ No |
| **GPU Memory** | ~500MB | ~800MB |
| **Best For** | Our workflow | Large structures, batch |
| **Award** | MedIA Best Paper 2022 | NeurIPS 2024 |

**Recommendation**: Use **Mem3D** as your primary AI prediction method. It's specifically designed for interactive annotation workflows and provides better performance in our use case.

## Additional Resources

- **Paper**: https://www.sciencedirect.com/science/article/pii/S1361841522001049
- **GitHub**: https://github.com/lingorX/Mem3D
- **Original Repo**: https://github.com/0liliulei/Mem3D
- **Integration Example**: See `SEGVOL_INTEGRATION_EXAMPLE.md` for similar pattern

## Support

For issues specific to:
- **Mem3D Integration**: Open an issue in this repository
- **Mem3D Model**: Check https://github.com/0liliulei/Mem3D/issues
- **Setup Questions**: See troubleshooting section above
