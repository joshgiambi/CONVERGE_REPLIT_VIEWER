#!/bin/bash
# Setup script for Mem3D service

set -e

echo "🔧 Setting up Mem3D service..."

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

# Clone Mem3D repository if not exists
if [ ! -d "Mem3D" ]; then
    echo "Cloning Mem3D repository..."
    # Try main repo first
    if ! git clone https://github.com/0liliulei/Mem3D.git; then
        echo "Main repo unavailable, trying alternate..."
        git clone https://github.com/lingorX/Mem3D.git
    fi

    cd Mem3D
    # Install any additional dependencies from Mem3D repo
    if [ -f "requirements.txt" ]; then
        pip install -r requirements.txt
    fi
    cd ..
fi

# Download pre-trained model weights (if available)
echo "Model weights will be loaded on first inference"
echo "Or manually download from Mem3D repository"

echo "✅ Mem3D setup complete!"
echo ""
echo "To start the service:"
echo "  source venv/bin/activate"
echo "  python mem3d_service.py --port 5002 --device cuda"
echo ""
echo "Or for CPU-only:"
echo "  python mem3d_service.py --port 5002 --device cpu"
