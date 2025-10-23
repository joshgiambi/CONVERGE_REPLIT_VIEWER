#!/bin/bash
# Start nnInteractive service

# Get device argument (default: cuda)
DEVICE=${1:-cuda}

# Validate device
if [ "$DEVICE" != "cuda" ] && [ "$DEVICE" != "cpu" ]; then
    echo "Usage: $0 [cuda|cpu]"
    echo "Example: $0 cuda"
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

# Start service
python3 nninteractive_service.py --device $DEVICE --port 5003 --host 127.0.0.1
