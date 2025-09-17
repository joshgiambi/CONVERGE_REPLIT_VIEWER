# ITK Transform IO Setup Guide

This guide explains how to ensure the development server always runs with ITK Transform IO support for DICOM REG to .h5 conversion.

## Quick Start

The easiest way to run the development server with ITK support:

```bash
./dev-with-itk.sh
```

Or use the new npm script:

```bash
npm run dev:itk
```

## Available Methods

### Method 1: Use the startup script (Recommended)
```bash
./dev-with-itk.sh
```

### Method 2: Use the npm script
```bash
npm run dev:itk
```

### Method 3: Source environment file
```bash
source itk-config.env && npm run dev
```

### Method 4: Manual environment variables
```bash
export DICOM_REG_CONVERTER="/Users/joshua/Documents/CONVERGE_REPLIT_VIEWER/build/dicom-reg-converter/dicom_reg_to_h5"
export FUSEBOX_PYTHON="/Users/joshua/Documents/CONVERGE_REPLIT_VIEWER/sam_env/bin/python"
export PORT="3000"
npm run dev
```

### Method 5: Create a .env file
```bash
# Copy the template and customize
cp itk-config.env .env
# Then just run:
npm run dev
```

## Environment Variables

The following environment variables are required for ITK Transform IO support:

- `DICOM_REG_CONVERTER`: Path to the `dicom_reg_to_h5` helper tool
- `FUSEBOX_PYTHON`: Path to the Python virtual environment
- `PORT`: Server port (optional, defaults to 3000)
- `NODE_ENV`: Environment mode (optional, defaults to development)

## Verification

When the server starts with ITK support, you should see:
- No `[REG converter failed]` warnings in the logs for valid REG files
- `.h5` files created in `tmp/fusebox-transforms/` directory
- Successful fusion/resampling operations

## Troubleshooting

### Helper tool not found
```bash
# Build the helper tool
cmake -S tools/dicom-reg-converter -B build/dicom-reg-converter -DITK_DIR=/Users/joshua/itk-dcmtk/lib/cmake/ITK-5.4
cmake --build build/dicom-reg-converter
```

### Python environment not found
```bash
# Verify the Python environment exists
ls -la /Users/joshua/Documents/CONVERGE_REPLIT_VIEWER/sam_env/bin/python
```

### REG converter failures
- This is normal for REG files that don't contain transforms for the requested frame of reference UIDs
- The system will fall back to the legacy matrix approach
- Only worry if ALL REG conversions are failing

## Replit Integration

The `.replit` file has been updated to use `./dev-with-itk.sh` by default, so clicking "Run" in Replit will automatically start with ITK support.

## Files Created

- `dev-with-itk.sh`: Startup script with environment validation
- `itk-config.env`: Environment variable configuration
- `ITK_SETUP.md`: This documentation
- Updated `package.json`: Added `dev:itk` script
- Updated `.replit`: Changed default run command
