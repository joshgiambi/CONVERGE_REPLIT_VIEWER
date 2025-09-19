#!/bin/bash

# Replit Setup and Start Script
# This script sets up ITK dependencies and starts the development server in Replit

set -e  # Exit on any error

echo "🔧 Setting up CONVERGE REPLIT VIEWER for Replit environment..."

# Set Replit-compatible environment variables
export REPLIT_WORKSPACE="/home/runner/CONVERGE_REPLIT_VIEWER"
export DICOM_REG_CONVERTER="$REPLIT_WORKSPACE/build/dicom-reg-converter/dicom_reg_to_h5"
export FUSEBOX_PYTHON="$REPLIT_WORKSPACE/sam_env/bin/python"
export NODE_ENV="development"
export PORT="3000"

echo "📍 DICOM_REG_CONVERTER: $DICOM_REG_CONVERTER"
echo "🐍 FUSEBOX_PYTHON: $FUSEBOX_PYTHON"
echo "🚀 PORT: $PORT"
echo ""

# Step 1: Install Python dependencies
echo "🐍 Setting up Python virtual environment..."
if [ ! -d "sam_env" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv sam_env
fi

# Activate virtual environment and install dependencies
source sam_env/bin/activate
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install numpy>=2.3.2 pydicom>=3.0.1 SimpleITK>=2.4.0

# Step 2: Build ITK DICOM converter tool
echo "🔨 Building ITK DICOM converter..."
if [ ! -f "$DICOM_REG_CONVERTER" ]; then
    echo "Building DICOM registration converter..."
    
    # Create build directory
    mkdir -p build/dicom-reg-converter
    
    # Configure with CMake (ITK should be available via Nix)
    cd build/dicom-reg-converter
    
    # Try to find ITK installation
    if [ -n "$ITK_DIR" ]; then
        echo "Using ITK_DIR: $ITK_DIR"
        cmake ../../tools/dicom-reg-converter -DITK_DIR="$ITK_DIR"
    else
        echo "Using system ITK installation..."
        cmake ../../tools/dicom-reg-converter
    fi
    
    # Build the tool
    make -j$(nproc)
    
    cd ../..
    
    if [ ! -f "$DICOM_REG_CONVERTER" ]; then
        echo "❌ Failed to build DICOM converter. Continuing without ITK support..."
        export DICOM_REG_CONVERTER=""
    else
        echo "✅ DICOM converter built successfully"
    fi
else
    echo "✅ DICOM converter already exists"
fi

# Step 3: Verify setup
echo "🔍 Verifying setup..."
if [ -f "$FUSEBOX_PYTHON" ]; then
    echo "✅ Python environment: OK"
    $FUSEBOX_PYTHON --version
else
    echo "❌ Python environment: FAILED"
fi

if [ -f "$DICOM_REG_CONVERTER" ]; then
    echo "✅ ITK converter: OK"
else
    echo "⚠️ ITK converter: Not available (will use fallback)"
fi

# Step 4: Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Step 5: Start the development server
echo "🚀 Starting development server..."
npm run dev:replit
