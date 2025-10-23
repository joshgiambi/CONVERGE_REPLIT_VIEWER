#!/bin/bash
# Quick start script for SegVol service

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
if [ ! -d "SegVol" ]; then
    echo "❌ SegVol repository not found. Run ./setup.sh first!"
    exit 1
fi

# Determine device
DEVICE=${1:-cuda}
PORT=${2:-5001}

echo "🚀 Starting SegVol service..."
echo "   Device: $DEVICE"
echo "   Port: $PORT"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start service
python segvol_service.py --port "$PORT" --device "$DEVICE"
