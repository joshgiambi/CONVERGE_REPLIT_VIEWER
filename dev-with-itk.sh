#!/bin/bash

# Development startup script with ITK Transform IO support
# This ensures the dev server always runs with the correct environment variables

export DICOM_REG_CONVERTER="/Users/joshua/Documents/CONVERGE_REPLIT_VIEWER/build/dicom-reg-converter/dicom_reg_to_h5"
export FUSEBOX_PYTHON="/Users/joshua/Documents/CONVERGE_REPLIT_VIEWER/sam_env/bin/python"
export NODE_ENV="development"
export PORT="3000"

echo "🔧 Starting development server with ITK Transform IO support..."
echo "📍 DICOM_REG_CONVERTER: $DICOM_REG_CONVERTER"
echo "🐍 FUSEBOX_PYTHON: $FUSEBOX_PYTHON"
echo "🚀 PORT: $PORT"
echo ""

# Verify helper tool exists
if [ ! -f "$DICOM_REG_CONVERTER" ]; then
    echo "❌ ERROR: Helper tool not found at $DICOM_REG_CONVERTER"
    echo "Please build the helper tool first:"
    echo "  cmake -S tools/dicom-reg-converter -B build/dicom-reg-converter -DITK_DIR=/Users/joshua/itk-dcmtk/lib/cmake/ITK-5.4"
    echo "  cmake --build build/dicom-reg-converter"
    exit 1
fi

# Verify Python environment exists
if [ ! -f "$FUSEBOX_PYTHON" ]; then
    echo "❌ ERROR: Python environment not found at $FUSEBOX_PYTHON"
    echo "Please create the Python virtual environment first."
    exit 1
fi

echo "✅ All dependencies verified. Starting server..."
npm run dev
