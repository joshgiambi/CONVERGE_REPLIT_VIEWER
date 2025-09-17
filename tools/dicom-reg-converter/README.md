# dicom_reg_to_h5 helper

This directory contains a tiny command line program that converts a DICOM Spatial Registration Object
(`.dcm` with modality `REG`) into an ITK transform file (`.h5`). The output can be consumed directly by
SimpleITK or ITK, allowing us to plug the Eclipse registrations into the Fusebox resampling pipeline
without maintaining a custom DICOM parser.

## Building

1. Configure ITK with the DCMTK transform IO module enabled:

```bash
cmake -DITK_BUILD_DEFAULT_MODULES=OFF \
      -DModule_ITKCommon=ON \
      -DModule_ITKIOTransformBase=ON \
      -DModule_ITKIOTransformHDF5=ON \
      -DModule_ITKIOTransformDCMTK=ON \
      -DBUILD_SHARED_LIBS=ON \
      -DCMAKE_INSTALL_PREFIX=$HOME/itk-dcmtk \
      /path/to/itk
cmake --build . --target install
```

2. Build the helper against that ITK install:

```bash
cmake -S tools/dicom-reg-converter \
      -B build/dicom-reg-converter \
      -DITK_DIR=$HOME/itk-dcmtk/lib/cmake/ITK-5.4
cmake --build build/dicom-reg-converter
```

The resulting binary `dicom_reg_to_h5` will live in `build/dicom-reg-converter` (and `bin/` if you run
`cmake --install`).

## Usage

```
dicom_reg_to_h5 --input REG.dcm --output transform.h5 --fixed <FoR_UID> --moving <FoR_UID>
```

- `--fixed` should be set to the Frame of Reference UID for the *fixed* / primary image series.
- `--moving` should be the Frame of Reference UID for the *moving* / secondary image series.

If only `--fixed` is supplied the helper simply exports the transform registered to that coordinate
system (handy for debugging).

Exit code is non-zero and a message is printed to `stderr` when the helper cannot find the requested
transform.

## Integrating with the server

Set `DICOM_REG_CONVERTER=/path/to/dicom_reg_to_h5` before starting the Node server. When present, the
Fusebox backend will call the helper whenever it resolves a registration pair and cache the generated
`.h5` file for reuse.

## Verification

After building the helper you can confirm it matches the raw Eclipse affine by running:

```bash
python3 scripts/verify_fusebox_transform.py \
  --helper /path/to/dicom_reg_to_h5
```

This compares the generated `.h5` against the 36↔37 CT/PT registration bundled with the
workspace, asserting that the helper emits the same fixed→moving affine and produces
identical resampled voxels.
