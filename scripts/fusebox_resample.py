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
from typing import List, Sequence, Tuple

import numpy as np
import SimpleITK as sitk

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from transform_utils import pick_moving_to_fixed  # noqa: E402


def parse_position_and_normal(reader: sitk.ImageFileReader) -> Tuple[np.ndarray, np.ndarray]:
    """Extract ImagePositionPatient and slice normal from DICOM metadata."""
    def meta_vec(tag: str) -> np.ndarray:
        if not reader.HasMetaDataKey(tag):
            raise RuntimeError(f"Missing required DICOM tag {tag}")
        raw = reader.GetMetaData(tag).strip().replace(',', '\\')
        return np.array([float(x.strip()) for x in raw.split('\\') if x.strip()], dtype=np.float64)

    ipp = meta_vec("0020|0032")
    iop = meta_vec("0020|0037")
    # Direction cosines: first three = row, next three = column
    normal = np.cross(iop[:3], iop[3:])
    norm = np.linalg.norm(normal)
    if norm == 0:
        raise RuntimeError("Slice normal has zero length")
    return ipp, normal / norm


def sort_series_by_position(files: Sequence[str]) -> List[str]:
    """Ensure slices are ordered along the physical slice normal."""
    if len(files) <= 1:
        return list(files)

    ordering: List[Tuple[float, str]] = []
    for path in files:
        reader = sitk.ImageFileReader()
        reader.SetFileName(path)
        reader.LoadPrivateTagsOn()
        reader.ReadImageInformation()
        try:
            ipp, normal = parse_position_and_normal(reader)
            distance = float(np.dot(ipp, normal))
        except Exception as exc:  # pragma: no cover - diagnostic path
            print(f"🐟 FUSION: Unable to compute slice ordering for {path}: {exc}", file=sys.stderr)
            distance = 0.0
        ordering.append((distance, path))

    ordering.sort(key=lambda item: item[0])
    return [path for _, path in ordering]


def describe_series(label: str, files: Sequence[str]) -> None:
    """Log basic DICOM metadata for the first instance in a series."""
    if not files:
        print(f"🐟 FUSION: {label} series list empty", file=sys.stderr)
        return

    first = files[0]
    reader = sitk.ImageFileReader()
    reader.SetFileName(first)
    reader.LoadPrivateTagsOn()
    try:
        reader.ReadImageInformation()
    except Exception as exc:  # pragma: no cover - debug aid only
        print(f"🐟 FUSION: Unable to inspect {label} metadata for {first}: {exc}", file=sys.stderr)
        return

    def meta(key: str) -> str:
        return reader.GetMetaData(key) if reader.HasMetaDataKey(key) else "unknown"

    modality = meta("0008|0060")
    description = meta("0008|103e")
    frame_of_reference = meta("0020|0052")
    series_uid = meta("0020|000e")

    try:
        ipp, normal = parse_position_and_normal(reader)
        top_proj = float(np.dot(ipp, normal))
    except Exception:
        normal = None
        top_proj = float('nan')

    bottom_proj = float('nan')
    if len(files) > 1:
        tail_reader = sitk.ImageFileReader()
        tail_reader.SetFileName(files[-1])
        tail_reader.LoadPrivateTagsOn()
        try:
            tail_reader.ReadImageInformation()
            tail_ipp, _ = parse_position_and_normal(tail_reader)
            bottom_proj = float(np.dot(tail_ipp, normal)) if normal is not None else float('nan')
        except Exception:
            bottom_proj = float('nan')

    print(
        "🐟 FUSION: {label} → modality={modality} description={desc} series={series_uid} FoR={for_uid}".format(
            label=label,
            modality=modality or "unknown",
            desc=(description or "").strip() or "(no description)",
            series_uid=series_uid or "unknown",
            for_uid=frame_of_reference or "unknown",
        ),
        file=sys.stderr,
    )
    if normal is not None:
        normal_list = [float(v) for v in normal]
        print(
            "🐟 FUSION: {label} slice normal {normal} · range [{top_proj:.3f}, {bottom_proj:.3f}]".format(
                label=label,
                normal=normal_list,
                top_proj=top_proj,
                bottom_proj=bottom_proj,
            ),
            file=sys.stderr,
        )


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
    
    # Debug the coordinate system mapping
    print(f"🐟 FUSION: Raw matrix translation: [{flat[3]}, {flat[7]}, {flat[11]}]", file=sys.stderr)
    print(f"🐟 FUSION: ProKnow expected: [-28.0, 471.2, 160.3]", file=sys.stderr)
    print(f"🐟 FUSION: Our values: [{flat[3]}, {flat[7]}, {flat[11]}]", file=sys.stderr)
    
    xform = sitk.AffineTransform(3)
    xform.SetMatrix(matrix)
    xform.SetTranslation(translation)
    return xform


def flatten_composite_transform(xform: sitk.Transform) -> sitk.Transform:
    """Flatten pathological CompositeTransform using ITK's FlattenTransformQueue."""
    if isinstance(xform, sitk.CompositeTransform):
        print(f"🐟 FUSION: Original CompositeTransform has {xform.GetNumberOfTransforms()} children", file=sys.stderr)
        
        try:
            if hasattr(xform, "FlattenTransformQueue"):
                # SimpleITK >=2.3
                xform.FlattenTransformQueue()
                print(f"🐟 FUSION: After flattening original: {xform.GetNumberOfTransforms()} transforms", file=sys.stderr)
            else:
                # Older SimpleITK builds: flatten manually by copying non-identity children
                manual = sitk.CompositeTransform(xform.GetDimension())
                for i in range(xform.GetNumberOfTransforms()):
                    child = xform.GetNthTransform(i)
                    try:
                        params = list(child.GetParameters())
                        if all(abs(p) <= 1e-8 for p in params):
                            continue
                    except Exception:
                        # If transform has no parameters (e.g., displacement field) keep it
                        pass
                    manual.AddTransform(child)
                if manual.GetNumberOfTransforms():
                    xform = manual
                print(f"🐟 FUSION: Manual flatten produced {xform.GetNumberOfTransforms()} transforms", file=sys.stderr)
            
            # If we now have a single transform, extract it
            if xform.GetNumberOfTransforms() == 1:
                single_transform = xform.GetNthTransform(0)
                print(f"🐟 FUSION: Extracted single transform: {single_transform.GetName()}", file=sys.stderr)
                return single_transform
            
            # If still multiple, look for the first meaningful one
            for i in range(min(xform.GetNumberOfTransforms(), 5)):
                try:
                    child = xform.GetNthTransform(i)
                    if isinstance(child, (sitk.Euler3DTransform, sitk.AffineTransform)):
                        params = list(child.GetParameters())
                        if any(abs(p) > 1e-6 for p in params):
                            print(f"🐟 FUSION: Found meaningful {child.GetName()} at index {i}", file=sys.stderr)
                            return child
                except Exception as e:
                    print(f"🐟 FUSION: Error accessing child {i}: {e}", file=sys.stderr)
            
            print(f"🐟 FUSION: Using flattened composite with {xform.GetNumberOfTransforms()} transforms", file=sys.stderr)
            return xform
            
        except Exception as e:
            print(f"🐟 FUSION: Error during flattening: {e}", file=sys.stderr)
            return xform
    
    print(f"🐟 FUSION: Not a CompositeTransform: {xform.GetName()}", file=sys.stderr)
    return xform

def ensure_moving_to_fixed(xform: sitk.Transform) -> sitk.Transform:
    """Fusebox consumes moving→fixed transforms; invert when needed.

    Some environments (SimpleITK builds) do not expose ITK's
    FlattenTransformQueue and certain CompositeTransform variants may not be
    invertible. In those cases, fall back to the original transform rather
    than failing hard, allowing resampling to proceed when the registration
    direction is already correct.
    """
    try:
        return xform.GetInverse()
    except Exception as exc:  # pragma: no cover - be permissive in production
        print(f"🐟 FUSION: Unable to invert transform, using as-is: {exc}", file=sys.stderr)
        return xform


def resample(primary: sitk.Image, secondary: sitk.Image, xform: sitk.Transform, interpolation: str) -> sitk.Image:
    resample_filter = sitk.ResampleImageFilter()
    resample_filter.SetReferenceImage(primary)
    resample_filter.SetTransform(xform)
    if interpolation.lower() == "nearest":
        resample_filter.SetInterpolator(sitk.sitkNearestNeighbor)
    else:
        resample_filter.SetInterpolator(sitk.sitkLinear)
    # Outside-of-FOV value: use 0 for PET-like (positive-only) data, -1000 for CT-like.
    # We cannot easily detect modality here; default to 0 to avoid white borders in hot colormaps.
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
    primary_files = sort_series_by_position([str(Path(p)) for p in cfg.get("primary", [])])
    secondary_files = sort_series_by_position([str(Path(p)) for p in cfg.get("secondary", [])])
    print(f"🐟 FUSION: Loading primary files: {primary_files[:2]}... ({len(primary_files)} total)", file=sys.stderr)
    print(f"🐟 FUSION: Loading secondary files: {secondary_files[:2]}... ({len(secondary_files)} total)", file=sys.stderr)
    describe_series("Primary", primary_files)
    describe_series("Secondary", secondary_files)
    transform = cfg.get("transform", [])
    transform_file = cfg.get("transformFile")
    invert_transform_file = bool(cfg.get("invertTransformFile", True))
    slice_index = int(cfg.get("sliceIndex", 0))
    interpolation = cfg.get("interpolation", "linear")

    if not primary_files or not secondary_files:
        raise ValueError("primary and secondary file lists required")

    primary = read_series(primary_files)
    secondary = read_series(secondary_files)

    if transform_file:
        raw_xform = sitk.ReadTransform(transform_file)
        # Flatten pathological CompositeTransform structure using ITK's FlattenTransformQueue
        xform = flatten_composite_transform(raw_xform)
        if invert_transform_file:
            xform = ensure_moving_to_fixed(xform)
    elif transform:
        print(f"🐟 FUSION: Using matrix transform with values: {transform[:4]}...", file=sys.stderr)
        raw = affine_from_row_major([float(v) for v in transform])
        print(f"🐟 FUSION: Created AffineTransform: {raw.GetName()}", file=sys.stderr)
        print(f"🐟 FUSION: Matrix: {list(raw.GetMatrix())[:3]}...", file=sys.stderr)
        print(f"🐟 FUSION: Translation: {list(raw.GetTranslation())}", file=sys.stderr)
        xform = ensure_moving_to_fixed(raw)
        print(f"🐟 FUSION: After inversion: {xform.GetName()}", file=sys.stderr)
        print(f"🐟 FUSION: Inverted translation: {list(xform.GetTranslation())}", file=sys.stderr)
    else:
        raise ValueError("Either transform or transformFile must be provided")

    try:
        xform = pick_moving_to_fixed(primary, secondary, xform)
        print("🐟 FUSION: pick_moving_to_fixed selected moving→fixed orientation", file=sys.stderr)
    except Exception as exc:
        print(f"🐟 FUSION: pick_moving_to_fixed failed, keeping original orientation: {exc}", file=sys.stderr)

    print(f"🐟 FUSION: Starting resampling with {xform.GetName()}", file=sys.stderr)
    print(f"🐟 FUSION: Primary image size: {primary.GetSize()}", file=sys.stderr)
    print(f"🐟 FUSION: Secondary image size: {secondary.GetSize()}", file=sys.stderr)
    
    try:
        resampled = resample(primary, secondary, xform, interpolation)
        print(f"🐟 FUSION: Resampling successful, output size: {resampled.GetSize()}", file=sys.stderr)
    except Exception as e:
        print(f"🐟 FUSION: Resampling failed: {e}", file=sys.stderr)
        raise
    
    try:
        resampled_slice = select_slice(resampled, slice_index)
        print(f"🐟 FUSION: Slice extraction successful", file=sys.stderr)
    except Exception as e:
        print(f"🐟 FUSION: Slice extraction failed: {e}", file=sys.stderr)
        raise

    if cfg.get("includePrimary"):
        primary_slice = select_slice(primary, slice_index).astype(np.float32)
        blend_slice = (primary_slice * 0.5) + (resampled_slice * 0.5)
        return {
            "sliceIndex": slice_index,
            "primary": encode_slice(primary_slice),
            "secondary": encode_slice(resampled_slice),
            "blend": encode_slice(blend_slice),
        }

    return encode_slice(resampled_slice)


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
