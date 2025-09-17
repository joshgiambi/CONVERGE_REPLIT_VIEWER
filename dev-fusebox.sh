#!/bin/bash

# Fusebox Development Server Startup Script
# This script handles all the setup needed for Fusebox development

set -e

echo "🔧 Setting up Fusebox development environment..."

# Get the absolute path to the project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Check if Python venv exists and has required packages
if [ ! -f "sam_env/bin/python" ]; then
    echo "❌ Python virtual environment not found at sam_env/"
    echo "Creating virtual environment..."
    python3 -m venv sam_env
    source sam_env/bin/activate
    echo "Installing Python dependencies..."
    pip install -e .
else
    echo "✅ Python virtual environment found"
    source sam_env/bin/activate
fi

# Check if DICOM helper is built
if [ ! -f "build/dicom-reg-converter/dicom_reg_to_h5" ]; then
    echo "❌ DICOM helper not found. Building..."
    if [ ! -d "build/dicom-reg-converter" ]; then
        echo "Creating build directory..."
        mkdir -p build/dicom-reg-converter
        cmake -S tools/dicom-reg-converter -B build/dicom-reg-converter
    fi
    cmake --build build/dicom-reg-converter
    echo "✅ DICOM helper built successfully"
else
    echo "✅ DICOM helper found"
fi

# Export environment variables
export DICOM_REG_CONVERTER="$PROJECT_ROOT/build/dicom-reg-converter/dicom_reg_to_h5"
export FUSEBOX_PYTHON="$PROJECT_ROOT/sam_env/bin/python"
export PORT=3000
export NODE_ENV=development

echo ""
echo "🐟 FUSION: Environment configured"
echo "   DICOM_REG_CONVERTER: $DICOM_REG_CONVERTER"
echo "   FUSEBOX_PYTHON: $FUSEBOX_PYTHON"
echo "   PORT: $PORT"
echo ""
echo "🚀 Starting development server..."
echo "   Watch for 'transformSource: helper-generated' or 'helper-cache' in API responses"
echo ""

# Start the development server
exec tsx watch server/index.ts


