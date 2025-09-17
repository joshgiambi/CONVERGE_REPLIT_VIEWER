#!/usr/bin/env python3
"""Fusebox: SimpleITK resampling helper.

Reads a JSON config via --config with keys:
  primary: list[str]  (CT reference series files)
  secondary: list[str]
  transform: list[16] row-major affine (moving->fixed)
  sliceIndex: int (0-based index into primary array)
  interpolation: 'linear' | 'nearest'

Outputs JSON with width/height/min/max/base64 data for Float32 slice.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import sys
from pathlib import Path
from typing import List

import numpy as np
import SimpleITK as sitk


def read_series(file_list: List[str]) -> sitk.Image:
    reader = sitk.ImageSeriesReader()
    reader.MetaDataDictionaryArrayUpdateOn()
    reader.LoadPrivateTagsOn()
    reader.SetFileNames(file_list)
    return reader.Execute()


def affine_from_row_major(flat: List[float]) -> sitk.AffineTransform:
    if len(flat) != 16:
        raise ValueError("transform must contain 16 values")
    matrix = [
        flat[0], flat[1], flat[2],
        flat[4], flat[5], flat[6],
        flat[8], flat[9], flat[10],
    ]
    translation = [flat[3], flat[7], flat[11]]
    xform = sitk.AffineTransform(3)
    xform.SetMatrix(matrix)
    xform.SetTranslation(translation)
    return xform


def resample(primary: sitk.Image, secondary: sitk.Image, xform: sitk.Transform, interpolation: str) -> sitk.Image:
    resample_filter = sitk.ResampleImageFilter()
    resample_filter.SetReferenceImage(primary)
    resample_filter.SetTransform(xform)
    if interpolation.lower() == "nearest":
        resample_filter.SetInterpolator(sitk.sitkNearestNeighbor)
    else:
        resample_filter.SetInterpolator(sitk.sitkLinear)
    resample_filter.SetDefaultPixelValue(0.0)
    resample_filter.SetOutputPixelType(sitk.sitkFloat32)
    return resample_filter.Execute(secondary)


def select_slice(image: sitk.Image, slice_index: int) -> np.ndarray:
    array = sitk.GetArrayFromImage(image)  # z, y, x
    depth = array.shape[0]
    if slice_index < 0 or slice_index >= depth:
        raise IndexError(f"sliceIndex {slice_index} not in [0,{depth-1}]")
    return np.asarray(array[slice_index, :, :], dtype=np.float32)


def encode_slice(slice_array: np.ndarray) -> dict:
    finite_mask = np.isfinite(slice_array)
    if np.any(finite_mask):
        clean_values = slice_array[finite_mask]
        min_val = float(clean_values.min())
        max_val = float(clean_values.max())
        if math.isclose(min_val, max_val):
            max_val = min_val + 1.0
        clean = np.where(finite_mask, slice_array, min_val).astype(np.float32)
    else:
        clean = np.zeros_like(slice_array, dtype=np.float32)
        min_val = 0.0
        max_val = 1.0

    payload = clean.tobytes(order="C")
    return {
        "width": int(slice_array.shape[1]),
        "height": int(slice_array.shape[0]),
        "min": min_val,
        "max": max_val,
        "data": base64.b64encode(payload).decode("ascii"),
    }


def run_from_config(cfg: dict) -> dict:
    primary_files = [str(Path(p)) for p in cfg.get("primary", [])]
    secondary_files = [str(Path(p)) for p in cfg.get("secondary", [])]
    transform = cfg.get("transform", [])
    transform_file = cfg.get("transformFile")
    slice_index = int(cfg.get("sliceIndex", 0))
    interpolation = cfg.get("interpolation", "linear")

    if not primary_files or not secondary_files:
        raise ValueError("primary and secondary file lists required")

    primary = read_series(primary_files)
    secondary = read_series(secondary_files)

    if transform_file:
        xform = sitk.ReadTransform(transform_file)
    elif transform:
        xform = affine_from_row_major([float(v) for v in transform])
    else:
        raise ValueError("Either transform or transformFile must be provided")

    resampled = resample(primary, secondary, xform, interpolation)
    slice_array = select_slice(resampled, slice_index)
    return encode_slice(slice_array)


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Fusebox resampler")
    parser.add_argument("--config", required=True)
    args = parser.parse_args(argv)

    config_path = Path(args.config)
    if not config_path.exists():
        print(json.dumps({"error": f"config not found: {config_path}"}))
        return 1

    cfg = json.loads(config_path.read_text())
    try:
        payload = run_from_config(cfg)
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"error": str(exc)}))
        return 2

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
