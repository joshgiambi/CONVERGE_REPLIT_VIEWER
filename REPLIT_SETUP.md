# Replit Setup Guide

This guide explains how to run CONVERGE REPLIT VIEWER in Replit with ITK and Python dependencies.

## Automatic Setup

When you click "Run" in Replit, the system will automatically:

1. **Install Python dependencies** (numpy, pydicom, SimpleITK)
2. **Build ITK DICOM converter** (if possible)
3. **Start the development server**

## Dependencies Included

### Python Dependencies (via pyproject.toml)
- `numpy>=2.3.2` - Numerical computing
- `pydicom>=3.0.1` - DICOM file handling
- `SimpleITK>=2.4.0` - Medical image processing

### ITK C++ Tool
- `dicom_reg_to_h5` - Converts DICOM registration files to HDF5 format
- Built from `tools/dicom-reg-converter/reg_to_h5.cxx`

### System Dependencies (via replit.nix)
- ITK library and development headers
- CMake and build tools
- HDF5 libraries
- Additional system libraries (zlib, libpng, libjpeg, etc.)

## Fallback Mode

If the ITK tool fails to build, the application will run in fallback mode:
- ⚠️ DICOM registration conversion will use legacy matrix approach
- 🐟 Fusion operations will still work but may be less accurate
- All other features remain fully functional

## Manual Setup (if needed)

If automatic setup fails, you can manually run:

```bash
# Build ITK tool
mkdir -p build/dicom-reg-converter
cd build/dicom-reg-converter
cmake ../../tools/dicom-reg-converter
make -j$(nproc)
cd ../..

# Setup Python environment
python3 -m venv sam_env
source sam_env/bin/activate
pip install numpy pydicom SimpleITK

# Start server
npm run dev:replit
```

## Environment Variables

The following environment variables are automatically set:

- `REPLIT_WORKSPACE` - Path to the project directory
- `DICOM_REG_CONVERTER` - Path to the ITK conversion tool (or empty for fallback)
- `FUSEBOX_PYTHON` - Path to Python interpreter
- `NODE_ENV=development`
- `PORT=3000`

## Verification

Look for these success messages in the startup logs:
- ✅ Python environment: OK
- ✅ ITK converter: OK (or ⚠️ fallback mode)
- ✅ DICOM helper found
- 🚀 Starting development server...

## Troubleshooting

### Build Failures
- The system is designed to gracefully handle build failures
- Check the console output for specific error messages
- The application will run in fallback mode if ITK tools can't be built

### Port Issues
- The application uses port 3000 (avoiding port 5000 which is commonly in use)
- Replit will automatically proxy this to the external port

### Memory Issues
- ITK compilation can be memory-intensive
- If builds fail, try restarting the Repl to free up memory

## Files Added for Replit Support

- `replit.nix` - Nix package configuration for system dependencies
- `replit-setup-and-start.sh` - Main startup script
- `REPLIT_SETUP.md` - This documentation
- Updated `.replit` - Configuration changes
- Updated `package.json` - Added `dev:replit` and `dev:setup:replit` scripts
