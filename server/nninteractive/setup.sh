#!/bin/bash
# Setup script for nnInteractive service

set -e

echo "======================================"
echo "nnInteractive Service Setup"
echo "======================================"

# Check Python version
python3 --version || { echo "Python 3 not found"; exit 1; }

# Create virtual environment
echo "Creating virtual environment..."
python3 -m venv venv

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install basic requirements
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Clone nnInteractive repository
echo "Cloning nnInteractive repository..."
if [ ! -d "nnInteractive" ]; then
    git clone https://github.com/MIC-DKFZ/nnInteractive.git
    cd nnInteractive

    # Install nnInteractive
    echo "Installing nnInteractive..."
    pip install -e .

    cd ..
else
    echo "nnInteractive directory already exists, skipping clone"
fi

# Download model weights
echo ""
echo "======================================"
echo "Model Download"
echo "======================================"
echo ""
echo "nnInteractive model weights need to be downloaded."
echo "The model will auto-download on first use, or you can:"
echo ""
echo "1. Auto-download (recommended):"
echo "   Model downloads automatically when you first run inference"
echo ""
echo "2. Manual download:"
echo "   Visit: https://github.com/MIC-DKFZ/nnInteractive/releases"
echo "   Download checkpoint and place in: nnInteractive/checkpoints/"
echo ""

# Check GPU
echo "Checking for GPU..."
python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"None\"}')"

echo ""
echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo ""
echo "To start the service:"
echo "  ./start-service.sh cuda     # Use GPU"
echo "  ./start-service.sh cpu      # Use CPU"
echo ""
