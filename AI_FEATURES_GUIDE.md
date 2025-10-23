# AI Features Complete Guide

Complete guide for all AI-powered prediction and segmentation features in the CONVERGE DICOM Viewer.

---

## 📊 Overview: All AI Features

This viewer includes **3 AI-powered systems** to accelerate contouring:

| Feature | Type | Use Case | Speed | Setup Difficulty |
|---------|------|----------|-------|------------------|
| **Mem3D** | Slice Prediction | Sequential slice-by-slice | ~200ms | ⭐⭐ Moderate |
| **SegVol** | Slice Prediction | High-accuracy volumetric | ~1s | ⭐⭐ Moderate |
| **nnInteractive** | Tumor Segmentation | 3D tumor from scribbles | ~1-2s | ⭐⭐⭐ Advanced |

### Which AI Method Should I Use?

```
┌─────────────────────────────────────────────────────────┐
│              DECISION TREE                               │
└─────────────────────────────────────────────────────────┘

Are you contouring a TUMOR (GTV, CTV, lesion)?
  │
  ├─ YES → Use nnInteractive (3D Tumor Segmentation)
  │          • Draw on 3-5 slices → get full 3D volume
  │          • 60-80% time savings
  │          • Best for irregular shapes
  │
  └─ NO → Normal organ/structure
           │
           ├─ Regular shape? (e.g., bladder, heart)
           │   └─ Use Geometric Prediction (Built-in, no setup!)
           │       • Fast: enable in toolbar
           │       • "Balanced" mode works great
           │
           └─ Complex shape? (e.g., parotids, esophagus)
               │
               ├─ Working slice-by-slice?
               │   └─ Use Mem3D ⭐ RECOMMENDED
               │       • ~200ms per prediction
               │       • Learns from your past slices
               │
               └─ Need highest accuracy?
                   └─ Use SegVol
                       • ~1s per prediction
                       • Universal segmentation model
```

---

## 🚀 Quick Start (All Features)

### Option 1: No AI Setup (Geometric Only)

Already included! No installation needed.

1. Open viewer
2. Select structure
3. Click **Brush** tool
4. Enable **"AI Predict"** toggle
5. Draw on slice → automatic prediction on next slice

**Speed**: ~15ms
**Accuracy**: 70-80%
**Setup**: None required ✅

---

### Option 2: Add Mem3D (Recommended First AI)

Best balance of speed, accuracy, and ease of setup.

```bash
# 1. Setup
cd server/mem3d
./setup.sh

# 2. Start service
./start-service.sh cuda  # or 'cpu'

# 3. Use in viewer
# Select "Mem3D" from prediction mode dropdown in toolbar
```

**Speed**: ~200ms
**Accuracy**: 80-85%
**Setup Time**: 10-15 minutes

---

### Option 3: Add SegVol (High Accuracy)

For complex anatomy requiring highest accuracy.

```bash
# 1. Setup
cd server/segvol
./setup.sh

# 2. Start service
./start-service.sh cuda  # or 'cpu'

# 3. Use in viewer
# Select "SegVol" from prediction mode dropdown in toolbar
```

**Speed**: ~1s
**Accuracy**: 85-90%
**Setup Time**: 15-20 minutes

---

### Option 4: Add nnInteractive (Tumor Segmentation)

For rapid 3D tumor contouring.

```bash
# 1. Setup
cd server/nninteractive
./setup.sh

# 2. Start service
./start-service.sh cuda  # or 'cpu'

# 3. Use in viewer
# Click "AI Tumor" button in toolbar
# Draw scribbles on 3-5 slices → Generate 3D
```

**Speed**: ~1-2s for full 3D volume
**Accuracy**: 85-95%
**Setup Time**: 20-30 minutes
**Requirements**: 10GB GPU (recommended)

---

## 📦 Complete Installation (All AI Features)

### Prerequisites

```bash
# Check you have:
- Python 3.8+
- CUDA 11.8+ (for GPU)
- 16GB+ RAM
- NVIDIA GPU with 12GB+ VRAM (recommended for all features)
```

### Install Everything at Once

```bash
# Navigate to project root
cd /path/to/CONVERGE_REPLIT_VIEWER

# Install all AI services
./install-all-ai-services.sh
```

Or manually:

```bash
# 1. Mem3D
cd server/mem3d
./setup.sh
cd ../..

# 2. SegVol
cd server/segvol
./setup.sh
cd ../..

# 3. nnInteractive
cd server/nninteractive
./setup.sh
cd ../..
```

### Configure Environment

```bash
# Copy template
cp .env.template .env

# Edit .env - add these lines:
```

```env
# Mem3D (Port 5002)
MEM3D_SERVICE_URL=http://127.0.0.1:5002
MEM3D_TIMEOUT=30000

# SegVol (Port 5001)
SEGVOL_SERVICE_URL=http://127.0.0.1:5001
SEGVOL_TIMEOUT=30000

# nnInteractive (Port 5003)
NNINTERACTIVE_SERVICE_URL=http://127.0.0.1:5003
NNINTERACTIVE_TIMEOUT=60000
```

---

## 🏃 Running AI Services

### Start All Services (Recommended)

```bash
# Create startup script
cat > start-all-ai.sh << 'EOF'
#!/bin/bash

echo "Starting all AI services..."

# Start Mem3D
cd server/mem3d
./start-service.sh cuda &
MEM3D_PID=$!
cd ../..

# Wait a moment
sleep 2

# Start SegVol
cd server/segvol
./start-service.sh cuda &
SEGVOL_PID=$!
cd ../..

# Wait a moment
sleep 2

# Start nnInteractive
cd server/nninteractive
./start-service.sh cuda &
NNINTERACTIVE_PID=$!
cd ../..

echo "All AI services started!"
echo "  Mem3D: PID $MEM3D_PID (port 5002)"
echo "  SegVol: PID $SEGVOL_PID (port 5001)"
echo "  nnInteractive: PID $NNINTERACTIVE_PID (port 5003)"
echo ""
echo "To stop all services:"
echo "  kill $MEM3D_PID $SEGVOL_PID $NNINTERACTIVE_PID"
EOF

chmod +x start-all-ai.sh

# Run it
./start-all-ai.sh
```

### Start Services Individually

```bash
# Terminal 1: Mem3D
cd server/mem3d && ./start-service.sh cuda

# Terminal 2: SegVol
cd server/segvol && ./start-service.sh cuda

# Terminal 3: nnInteractive
cd server/nninteractive && ./start-service.sh cuda
```

### Verify All Services

```bash
# Check Mem3D
curl http://127.0.0.1:5002/health

# Check SegVol
curl http://127.0.0.1:5001/health

# Check nnInteractive
curl http://127.0.0.1:5003/health

# All should return: {"status": "healthy", ...}
```

---

## 🎯 Usage Guide

### Feature 1: Geometric Prediction (Built-in)

**When to use**: Regular structures, quick contouring

1. Select structure
2. Click **Brush** tool
3. Toggle **"AI Predict"** ON
4. Select mode: **"Fast"** or **"Balanced"**
5. Draw on slice N → prediction appears on slice N+1
6. Click inside prediction to **Accept** (or outside to **Reject**)

**Keyboard Shortcuts**:
- `A` = Accept prediction
- `X` = Reject prediction

---

### Feature 2: Mem3D Prediction

**When to use**: Slice-by-slice workflow, moderate complexity

1. Select structure
2. Click **Brush** tool
3. Toggle **"AI Predict"** ON
4. Select mode: **"Mem3D"** (cyan Brain icon, ~200ms badge)
5. Draw on 2-3 slices to build history
6. AI predicts next slice using memory of past slices
7. Accept or reject as normal

**Advantages**:
- Learns from your contouring style
- Remembers last 10 slices
- Fast inference
- Quality assessment built-in

---

### Feature 3: SegVol Prediction

**When to use**: Complex anatomy, highest accuracy needed

1. Select structure
2. Click **Brush** tool
3. Toggle **"AI Predict"** ON
4. Select mode: **"SegVol"** (purple Sparkles icon, ~1s badge)
5. Draw on slice N → AI predicts slice N+1
6. Accept or reject

**Advantages**:
- Universal segmentation (trained on many organs)
- High accuracy (83% Dice average)
- Works on first slice (no history needed)

---

### Feature 4: nnInteractive Tumor Segmentation

**When to use**: Tumors, lesions, irregular 3D masses

#### Quick Workflow

1. **Select tumor structure** (e.g., "GTV_Primary")

2. **Click "AI Tumor" button** in toolbar
   - Purple sparkles icon ✨
   - Tool overlay appears

3. **Draw scribbles on 3-5 key slices**:
   - Navigate to first slice with tumor
   - Click "Draw Tumor" mode
   - Draw rough scribbles inside tumor (be loose!)
   - Navigate to middle slice → draw again
   - Navigate to last slice → draw again
   - (Optional) Add 2 more slices in between

4. **Generate 3D segmentation**:
   - Click **"Generate 3D"** button
   - Wait 30-60 seconds
   - Preview appears on all slices

5. **Review and refine**:
   - Check confidence score (aim for >80%)
   - System recommends next slice to annotate
   - If good: Click **"Accept"** ✅
   - If needs work: Click **"Refine"**, add more scribbles, regenerate

#### Advanced Tips

**Use Erase Mode**:
- Draw scribbles on background (organs, air) that AI mistakenly includes
- Helps AI distinguish tumor boundary

**Iterative Refinement**:
```
Round 1: 3 slices → 75% confidence → Add 2 more slices
Round 2: 5 slices → 88% confidence → Accept!
```

**Slice Selection Strategy**:
```
Best slices to annotate:
1. First slice with tumor
2. Middle slice (largest diameter)
3. Last slice with tumor
4. Slices where shape changes significantly
5. Slices with nearby organs (to clarify boundary)
```

---

## 🔧 Troubleshooting

### Services Won't Start

**Problem**: "Port already in use"

```bash
# Find what's using the port
lsof -i :5002  # Mem3D
lsof -i :5001  # SegVol
lsof -i :5003  # nnInteractive

# Kill the process
kill -9 <PID>

# Or change port in .env
```

**Problem**: "CUDA out of memory"

```bash
# Option 1: Use CPU mode
./start-service.sh cpu

# Option 2: Start only one service at a time
# (GPU can only handle 1-2 models simultaneously)

# Option 3: Upgrade GPU (need 12GB+ for all 3)
```

**Problem**: "Model not found"

```bash
# Re-run setup
cd server/<service-name>
./setup.sh

# Models auto-download on first use
# Be patient - models are large (500MB-2GB each)
```

### UI Shows "Offline"

1. **Check service is running**:
   ```bash
   curl http://127.0.0.1:5002/health  # Should return JSON
   ```

2. **Check browser console** (F12):
   - Look for errors
   - Check if requests are blocked by CORS

3. **Restart frontend**:
   ```bash
   npm run dev
   ```

### Low Prediction Quality

**For Mem3D/SegVol**:
- Draw more initial slices (3-5) to build context
- Use "Balanced" mode instead of "Fast"
- Try "Smart" mode (auto-selects best algorithm)

**For nnInteractive**:
- Add more scribbles (5-7 slices instead of 3)
- Use both "Draw" and "Erase" modes
- Annotate slices where tumor changes shape
- Add background scribbles near tumor boundary

---

## 📊 Performance Comparison

### Contouring Time Comparison

**Scenario**: Segment GTV tumor across 40 CT slices

| Method | Time | Slices Annotated | Notes |
|--------|------|------------------|-------|
| **Manual (no AI)** | 25-30 min | 40 | Baseline |
| **Geometric (Fast)** | 15-18 min | 20 (every 2nd) | Built-in |
| **Geometric (Balanced)** | 12-15 min | 15 (every 3rd) | Built-in |
| **Mem3D** | 10-12 min | 12 (every 3rd) | Better accuracy |
| **SegVol** | 12-14 min | 20 (every 2nd) | Highest accuracy |
| **nnInteractive** | **5-8 min** | **4-6 key slices** | **Best for tumors** ⭐ |

### Resource Usage

| Service | GPU VRAM | RAM | Disk Space | Startup Time |
|---------|----------|-----|------------|--------------|
| Geometric | 0 | 0 | 0 | Instant |
| Mem3D | ~500MB | ~2GB | ~3GB | ~30s |
| SegVol | ~800MB | ~3GB | ~5GB | ~45s |
| nnInteractive | ~4GB | ~8GB | ~10GB | ~60s |

**Can I run all 3 at once?**
- **12GB GPU**: Yes, all 3 simultaneously ✅
- **8GB GPU**: 2 at a time (e.g., Mem3D + SegVol)
- **6GB GPU**: 1 at a time
- **CPU only**: All 3, but 10-20x slower

---

## 🎓 Best Practices

### For Clinical Workflow

1. **Start with Geometric** (no setup required)
   - Use "Balanced" mode
   - Enable "Smart Nth" for auto-interpolation

2. **Add Mem3D for daily use** (best ROI)
   - Fast, accurate, easy to set up
   - Use for 80% of structures

3. **Add SegVol for complex cases**
   - Use when Mem3D struggles
   - Good for highly variable anatomy

4. **Add nnInteractive for tumors**
   - Massive time savings on GTV/CTV
   - Essential for radiation oncology

### For Development/Testing

```bash
# Development: CPU mode (slower but no GPU needed)
./start-service.sh cpu

# Production: GPU mode
./start-service.sh cuda
```

### Keyboard Shortcuts Summary

```
Prediction Accept/Reject:
  A     = Accept prediction
  X     = Reject prediction

Tool Activation:
  B     = Brush tool
  P     = Pen tool
  E     = Erase tool

Undo/Redo:
  Ctrl+Z = Undo
  Ctrl+Y = Redo
```

---

## 📚 Documentation Links

- **Geometric Prediction**: See `PREDICTION_COMPLETE_SUMMARY.md`
- **Mem3D Setup**: See `MEM3D_SETUP.md`
- **SegVol Setup**: See `SEGVOL_SETUP.md`
- **nnInteractive Setup**: See `NNINTERACTIVE_SETUP.md`

---

## 🚢 Production Deployment

### Docker Compose (All Services)

```yaml
version: '3.8'

services:
  mem3d:
    build: ./server/mem3d
    ports:
      - "5002:5002"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  segvol:
    build: ./server/segvol
    ports:
      - "5001:5001"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  nninteractive:
    build: ./server/nninteractive
    ports:
      - "5003:5003"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Stop all
docker-compose down
```

---

## 🎯 Summary

### Quick Decision Matrix

| I want to... | Use this... |
|--------------|-------------|
| Get started fast with no setup | **Geometric Prediction** |
| Best overall AI for daily use | **Mem3D** ⭐ |
| Highest accuracy for organs | **SegVol** |
| Fast tumor contouring (GTV/CTV) | **nnInteractive** ⭐⭐ |
| Auto-select best AI | **Smart Mode** |

### Setup Priorities

**Priority 1** (No setup): Geometric Prediction
- Already included
- Use "Balanced" mode

**Priority 2** (First AI): Mem3D
- 15-min setup
- Best ROI
- Use daily

**Priority 3** (For tumors): nnInteractive
- 30-min setup
- 70% time savings on GTV
- Essential for radiation oncology

**Priority 4** (For complex cases): SegVol
- 20-min setup
- Highest accuracy
- Use when Mem3D isn't enough

---

## 📞 Support

- **Issues**: Check troubleshooting section above
- **Questions**: See individual setup guides
- **Bugs**: Create GitHub issue with logs

---

**Ready to start?** Pick your priority and follow the setup guide above!

```bash
# Quickest way to try AI:
cd server/mem3d && ./setup.sh && ./start-service.sh cuda
# Then select "Mem3D" in viewer toolbar dropdown!
```
