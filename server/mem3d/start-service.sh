#!/bin/bash
# Quick start script for Mem3D service

set -e

cd "$(dirname "$0")"

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found. Run ./setup.sh first!"
    exit 1
fi

# Activate virtual environment
source venv/bin/activate

# Check if model is available
if [ ! -d "Mem3D" ]; then
    echo "❌ Mem3D repository not found. Run ./setup.sh first!"
    exit 1
fi

# Determine device
DEVICE=${1:-cuda}
PORT=${2:-5002}

echo "🚀 Starting Mem3D service..."
echo "   Device: $DEVICE"
echo "   Port: $PORT"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start service
python mem3d_service.py --port "$PORT" --device "$DEVICE"
