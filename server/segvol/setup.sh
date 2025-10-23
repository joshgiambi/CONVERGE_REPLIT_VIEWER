#!/bin/bash
# Setup script for SegVol service

set -e

echo "🔧 Setting up SegVol service..."

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install dependencies
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Clone SegVol repository if not exists
if [ ! -d "SegVol" ]; then
    echo "Cloning SegVol repository..."
    git clone https://github.com/BAAI-DCAI/SegVol.git
    cd SegVol
    # Install SegVol package
    if [ -f "setup.py" ]; then
        pip install -e .
    fi
    cd ..
fi

# Download model weights (optional - can be done on first run)
echo "Model weights will be downloaded automatically on first inference"
echo "Or manually download from: https://huggingface.co/BAAI/SegVol"

echo "✅ SegVol setup complete!"
echo ""
echo "To start the service:"
echo "  source venv/bin/activate"
echo "  python segvol_service.py --port 5001 --device cuda"
echo ""
echo "Or for CPU-only:"
echo "  python segvol_service.py --port 5001 --device cpu"
