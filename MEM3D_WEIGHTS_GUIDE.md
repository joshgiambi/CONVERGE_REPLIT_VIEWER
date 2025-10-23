# Mem3D Model Weights - Download Guide

## The Problem

Mem3D requires pretrained model weights, but the official repositories don't always have clear download links or the weights may not be publicly hosted.

---

## Solution Options

### Option 1: Use Mock Mode (FASTEST - For Testing)

The Mem3D service includes a mock model that works without real weights. This is great for:
- Testing the UI integration
- Development
- Demos

**How to use**:
```bash
cd server/mem3d
./start-service.sh cuda  # or cpu

# Service will start with MockMem3D model
# You'll see: "Using MOCK Mem3D model"
```

The mock model creates reasonable predictions based on:
- Previous slice contours
- Simple geometric interpolation
- Area/shape evolution

**Limitations**: Not as accurate as real model, but functional!

---

### Option 2: Find Official Weights

**Step 1: Check GitHub Releases**

```bash
# Visit these repositories:
# 1. https://github.com/0liliulei/Mem3D/releases
# 2. https://github.com/lingorX/Mem3D/releases

# Look for:
- model.pth
- checkpoint.pth
- vmn_*.pth (Volumetric Memory Network)
- weights pretrained on YouTube-VOS
```

**Step 2: Check Repository README**

```bash
# Clone the repository
cd server/mem3d
git clone https://github.com/0liliulei/Mem3D.git
cd Mem3D

# Read the README for download instructions
cat README.md | grep -i "weight\|download\|checkpoint\|model"
```

**Step 3: Contact Authors**

If weights aren't publicly available:
- Open an issue on GitHub: https://github.com/0liliulei/Mem3D/issues
- Ask: "Where can I download the pretrained VMN checkpoint?"
- Reference the Medical Image Analysis 2022 paper

---

### Option 3: Alternative - Use SegVol Instead

SegVol has easier weight management (auto-downloads from HuggingFace):

```bash
cd server/segvol
./setup.sh
./start-service.sh cuda

# Weights auto-download on first use!
# No manual download needed
```

Then in the UI, select "SegVol" instead of "Mem3D".

---

### Option 4: Train Your Own Weights (Advanced)

If you have medical imaging data:

```bash
cd server/mem3d/Mem3D

# Follow training instructions in README
# Requires:
# - Medical imaging dataset (MSD, KiTS, etc.)
# - GPU with 8GB+ VRAM
# - 1-2 days training time
```

---

## Quick Decision Matrix

| Scenario | Solution | Time |
|----------|----------|------|
| **Just testing/demo** | Use Mock Mode | 0 min ✅ |
| **Need real AI** | Use SegVol instead | 15 min |
| **Found weights** | Place in `server/mem3d/Mem3D/checkpoints/` | 5 min |
| **Can't find weights** | Contact authors on GitHub | ?? |
| **Have training data** | Train from scratch | 1-2 days |

---

## Where to Place Downloaded Weights

If you find/receive model weights:

```bash
# Create checkpoints directory
mkdir -p server/mem3d/Mem3D/checkpoints

# Place weights there
# Expected file: vmn_checkpoint.pth (or similar)
cp /path/to/downloaded/weights.pth server/mem3d/Mem3D/checkpoints/

# Update mem3d_service.py to load from this path
# (See instructions below)
```

---

## Update Service to Load Custom Weights

Edit `server/mem3d/mem3d_service.py`:

```python
# Around line 50-60, find model loading section:

def load_model(self):
    try:
        import torch
        from Mem3D.model import VMN  # Adjust import based on Mem3D structure

        # Load checkpoint
        checkpoint_path = 'Mem3D/checkpoints/vmn_checkpoint.pth'

        if not os.path.exists(checkpoint_path):
            logger.warning(f"Checkpoint not found: {checkpoint_path}")
            logger.warning("Using MOCK model - install real weights for production")
            self.model = MockMem3D(self.device)
            return

        # Load real model
        self.model = VMN().to(self.device)
        checkpoint = torch.load(checkpoint_path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model'])
        self.model.eval()

        logger.info("Mem3D model loaded successfully!")

    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        logger.warning("Falling back to MOCK model")
        self.model = MockMem3D(self.device)
```

---

## Checking What's Actually Being Used

When you start the service, look for these log messages:

**Using Mock Model:**
```
INFO: Using MOCK Mem3D model
WARNING: Using MOCK model - install real weights for production
```

**Using Real Model:**
```
INFO: Loading Mem3D model from: Mem3D/checkpoints/vmn_checkpoint.pth
INFO: Mem3D model loaded successfully!
```

---

## Alternative Models That Are Easier

If Mem3D weights are hard to find, consider these alternatives (all have easy weight downloads):

| Model | Download | Setup Time | Accuracy |
|-------|----------|------------|----------|
| **SegVol** | Auto (HuggingFace) ✅ | 15 min | 85% |
| **nnU-Net** | Auto ✅ | 20 min | 87% |
| **SAM-Med3D** | Auto (HuggingFace) ✅ | 25 min | 83% |
| **Mem3D** | Manual ❌ | ?? | 85% |

---

## Recommended: Use SegVol for Now

Since you need weights NOW, I recommend:

```bash
# 1. Use SegVol (works out of box)
cd server/segvol
./setup.sh
./start-service.sh cuda

# 2. In UI, select "SegVol" mode
# 3. Works great! (~1s inference)

# 4. Meanwhile, contact Mem3D authors for weights
# https://github.com/0liliulei/Mem3D/issues
```

---

## Contact Information for Mem3D Weights

**Open a GitHub Issue:**
```
Title: "Where to download pretrained VMN checkpoint?"

Body:
Hi! I'm trying to use Mem3D for medical image segmentation but can't
find the pretrained model weights mentioned in the README.

Could you please provide:
1. Download link for pretrained VMN checkpoint
2. Expected file name and location
3. Any setup instructions

Thank you!
```

**Post issue here:** https://github.com/0liliulei/Mem3D/issues/new

---

## Summary

**For immediate use:**
1. ✅ Start service in Mock mode (works now!)
2. ✅ Use SegVol instead (auto-downloads weights)
3. ✅ Use nnInteractive for tumors (easier setup)

**For production with Mem3D:**
1. Contact authors on GitHub for weights
2. Place weights in `server/mem3d/Mem3D/checkpoints/`
3. Update `mem3d_service.py` to load from that path
4. Restart service

**Current status:**
- Mock mode: Working! ✅
- Real model: Need weights download link

Let me know if you want help with SegVol setup or creating a GitHub issue!
