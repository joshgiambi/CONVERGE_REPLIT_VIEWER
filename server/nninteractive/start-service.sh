#!/bin/bash
# Start nnInteractive service

# Get device argument (default: cpu for wider compatibility)
DEVICE=${1:-cpu}

# Validate device
if [ "$DEVICE" != "cuda" ] && [ "$DEVICE" != "cpu" ] && [ "$DEVICE" != "mps" ]; then
    echo "Usage: $0 [cuda|cpu|mps]"
    echo "Example: $0 cuda"
    echo "  mps - Use Apple Metal GPU (M1/M2/M3/M4)"
    exit 1
fi

echo "Starting nnInteractive service with device: $DEVICE"

# Activate virtual environment
if [ -d "venv" ]; then
    source venv/bin/activate
else
    echo "Virtual environment not found. Run ./setup.sh first"
    exit 1
fi

# Enable MPS fallback for unsupported operations
if [ "$DEVICE" = "mps" ]; then
    export PYTORCH_ENABLE_MPS_FALLBACK=1
    echo "MPS fallback enabled for unsupported operations"
fi

# Ensure Matplotlib cache is writable (avoids warnings on macOS sandboxed envs)
export MPLCONFIGDIR="${MPLCONFIGDIR:-$(pwd)/.matplotlib-cache}"
mkdir -p "$MPLCONFIGDIR"

# Start service
python3 nninteractive_service.py --device $DEVICE --port 5003 --host 127.0.0.1
