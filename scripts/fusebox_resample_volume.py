#!/usr/bin/env python3
"""Fusebox volume resampler.

Reads a JSON config via --config with keys:
  primary: list[str]
  secondary: list[str]
  transform: list[16] optional
  transformFile: str optional
  invertTransformFile: bool optional (default True)
  interpolation: 'linear' | 'nearest' (default 'linear')
  outputDirectory: str (destination root)
  metadata: dict with patient/study/series information

Outputs JSON summary describing generated series and instances.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple

import SimpleITK as sitk
import numpy as np

# Add parent directory for helper imports
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from fusebox_resample import (  # noqa: E402
    sort_series_by_position,
    read_series,
    affine_from_row_major,
)
from transform_utils import (
    flatten_composite_transform,
    ensure_moving_to_fixed,
    pick_moving_to_fixed,
)  # noqa: E402


def dicom_uid(root: str = "2.25") -> str:
    return f"{root}.{uuid.uuid4().int}"


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def load_transform(cfg: Dict[str, Any]) -> sitk.Transform:
    transform_file = cfg.get("transformFile")
    invert_transform_file = bool(cfg.get("invertTransformFile", True))
    transform = cfg.get("transform", []) or None

    if transform_file:
        raw_xform = sitk.ReadTransform(str(transform_file))
        xform = flatten_composite_transform(raw_xform)
        if invert_transform_file:
            xform = ensure_moving_to_fixed(xform)
        return xform

    if transform:
        matrix_vals = [float(v) for v in transform]
        raw = affine_from_row_major(matrix_vals)
        xform = ensure_moving_to_fixed(raw)
        return xform

    raise ValueError("Either transform or transformFile must be provided")


def extract_orientation(image: sitk.Image) -> Tuple[List[float], List[float]]:
    direction = list(image.GetDirection())
    if len(direction) == 9:
        row = [direction[0], direction[3], direction[6]]
        col = [direction[1], direction[4], direction[7]]
        return row, col
    if len(direction) == 6:
        return direction[:3], direction[3:]
    raise ValueError("Unexpected direction length")


def transform_index_to_position(image: sitk.Image, index: Tuple[int, int, int]) -> List[float]:
    point = image.TransformIndexToPhysicalPoint(index)
    return [float(point[0]), float(point[1]), float(point[2])]


def cast_to_float(image: sitk.Image) -> sitk.Image:
    if image.GetPixelID() == sitk.sitkFloat32:
        return image
    return sitk.Cast(image, sitk.sitkFloat32)


def format_multi(values: List[float] | None) -> str | None:
    if not values:
        return None
    return "\\".join(f"{v:g}" for v in values)


def normalize_dicom_value(value: Any) -> str | None:
    """Convert supported metadata values into DICOM-friendly strings."""
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    if isinstance(value, str):
        return value
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    if isinstance(value, (float, np.floating)):
        if math.isnan(value) or math.isinf(value):
            return None
        return f"{float(value):g}"
    if isinstance(value, (list, tuple)):
        parts = [normalize_dicom_value(v) for v in value]
        parts = [p for p in parts if p is not None]
        if not parts:
            return None
        return "\\".join(parts)
    return str(value)


def determine_sop_class(modality: str | None) -> str:
    if not modality:
        return "1.2.840.10008.5.1.4.1.1.2"  # default CT
    mode = modality.upper()
    if mode in {"CT"}:
        return "1.2.840.10008.5.1.4.1.1.2"
    if mode in {"PT", "PET"}:
        return "1.2.840.10008.5.1.4.1.1.128"
    if mode in {"MR"}:
        return "1.2.840.10008.5.1.4.1.1.4"
    if mode in {"CBCT"}:
        return "1.2.840.10008.5.1.4.1.1.13"
    return "1.2.840.10008.5.1.4.1.1.2"


def apply_shared_tags(slice_img: sitk.Image, tags: Dict[str, str]) -> None:
    for key, value in tags.items():
        normalized = normalize_dicom_value(value)
        if normalized is None:
            continue
        slice_img.SetMetaData(key, normalized)


def write_dicom_series(
    image: sitk.Image,
    output_dir: Path,
    metadata: Dict[str, Any],
    instances: List[Dict[str, Any]],
) -> Dict[str, str]:
    ensure_directory(output_dir)
    writer = sitk.ImageFileWriter()
    writer.KeepOriginalImageUIDOn()

    size = image.GetSize()
    depth = size[2] if len(size) > 2 else 1
    row_cosines, col_cosines = extract_orientation(image)
    pixel_spacing = list(image.GetSpacing())
    if len(pixel_spacing) < 3:
        pixel_spacing = list(pixel_spacing) + [1.0]
    spacing_row = pixel_spacing[1]
    spacing_col = pixel_spacing[0]
    slice_thickness = metadata.get("sliceThickness") or f"{pixel_spacing[2]:g}"
    spacing_between = metadata.get("spacingBetweenSlices") or f"{pixel_spacing[2]:g}"

    patient_meta = metadata.get("patient", {})
    study_meta = metadata.get("study", {})
    primary_meta = metadata.get("primarySeries", {})
    secondary_meta = metadata.get("secondarySeries", {})
    derived_meta = metadata.get("derivedSeries", {})

    modality = secondary_meta.get("Modality") or primary_meta.get("Modality") or "CT"
    sop_class_uid = determine_sop_class(modality)
    image_type = derived_meta.get("ImageType") or ["DERIVED", "SECONDARY", "FUSED"]
    image_type_str = "\\".join(image_type)

    study_uid = study_meta.get("StudyInstanceUID") or dicom_uid()
    series_uid = derived_meta.get("SeriesInstanceUID") or dicom_uid()
    frame_of_reference_uid = primary_meta.get("FrameOfReferenceUID") or dicom_uid()
    series_description = derived_meta.get("SeriesDescription") or "Fusion Secondary"
    series_number = derived_meta.get("SeriesNumber")
    series_number_str = "9901"
    if series_number not in (None, ""):
        try:
            series_number_str = str(int(series_number))
        except (TypeError, ValueError):
            series_number_str = "9901"

    window_center = derived_meta.get("WindowCenter") or secondary_meta.get("WindowCenter")
    window_width = derived_meta.get("WindowWidth") or secondary_meta.get("WindowWidth")
    # Prefer derived rescale params if provided; fall back to secondary
    rescale_intercept = derived_meta.get("RescaleIntercept", secondary_meta.get("RescaleIntercept"))
    rescale_slope = derived_meta.get("RescaleSlope", secondary_meta.get("RescaleSlope"))
    photometric = secondary_meta.get("PhotometricInterpretation") or "MONOCHROME2"
    samples_per_pixel = secondary_meta.get("SamplesPerPixel") or 1

    # Choose bit depth based on actual image pixel type
    pixel_id = image.GetPixelID()
    if pixel_id == sitk.sitkUInt16:
        bits_allocated = 16
        bits_stored = 16
        high_bit = 15
        pixel_representation = 0
    elif pixel_id == sitk.sitkFloat32:
        bits_allocated = 32
        bits_stored = 32
        high_bit = 31
        pixel_representation = 0
    else:
        # Fallback: try to derive from secondary meta or default to 16
        bits_allocated = int(secondary_meta.get("BitsAllocated") or 16)
        bits_stored = int(secondary_meta.get("BitsStored") or bits_allocated)
        high_bit = int(secondary_meta.get("HighBit") or (bits_stored - 1))
        pixel_representation = int(secondary_meta.get("PixelRepresentation") or 0)

    shared_tags = {
        "0008|0008": image_type_str,
        "0008|0016": sop_class_uid,
        "0008|0060": modality,
        "0008|103e": series_description,
        "0010|0010": patient_meta.get("PatientName") or "",
        "0010|0020": patient_meta.get("PatientID") or "",
        "0010|0030": patient_meta.get("PatientBirthDate") or "",
        "0010|0040": patient_meta.get("PatientSex") or "",
        "0010|1010": patient_meta.get("PatientAge") or "",
        "0008|0020": study_meta.get("StudyDate") or "",
        "0008|0030": study_meta.get("StudyTime") or "",
        "0008|0050": study_meta.get("AccessionNumber") or "",
        "0008|0090": study_meta.get("ReferringPhysicianName") or "",
        "0020|000d": study_uid,
        "0020|000e": series_uid,
        "0020|0011": series_number_str,
        "0020|0052": frame_of_reference_uid,
        "0028|0002": str(samples_per_pixel),
        "0028|0004": photometric,
        "0028|0030": f"{spacing_row:g}\\{spacing_col:g}",
        "0018|0050": str(slice_thickness),
        "0018|0088": str(spacing_between),
        "0028|0100": str(bits_allocated),
        "0028|0101": str(bits_stored),
        "0028|0102": str(high_bit),
        "0028|0103": str(pixel_representation),
    }

    if window_center:
        shared_tags["0028|1050"] = "\\".join(str(float(v)) for v in window_center)
    if window_width:
        shared_tags["0028|1051"] = "\\".join(str(float(v)) for v in window_width)
    if rescale_intercept is not None:
        shared_tags["0028|1052"] = str(float(rescale_intercept))
    if rescale_slope is not None:
        shared_tags["0028|1053"] = str(float(rescale_slope))
    if derived_meta.get("DerivationDescription"):
        shared_tags["0008|2111"] = derived_meta["DerivationDescription"]

    referenced_series_uid = derived_meta.get("ReferencedSeriesInstanceUID") or primary_meta.get("SeriesInstanceUID")
    if referenced_series_uid:
        shared_tags["0008|1115"] = json.dumps({
            "SeriesInstanceUID": referenced_series_uid,
        })

    for tag, value in derived_meta.get("AdditionalTags", {}).items():
        shared_tags[tag] = value

    depth_range = range(depth)
    for idx in depth_range:
        slice_img = sitk.Extract(image, [size[0], size[1], 0], [0, 0, idx])
        sop_uid = dicom_uid()
        position = transform_index_to_position(image, (0, 0, idx))

        instance_tags = {
            **shared_tags,
            "0008|0018": sop_uid,
            "0020|0013": str(idx + 1),
            "0020|0037": f"{row_cosines[0]:.12f}\\{row_cosines[1]:.12f}\\{row_cosines[2]:.12f}\\{col_cosines[0]:.12f}\\{col_cosines[1]:.12f}\\{col_cosines[2]:.12f}",
            "0020|0032": f"{position[0]:.12f}\\{position[1]:.12f}\\{position[2]:.12f}",
        }

        apply_shared_tags(slice_img, instance_tags)

        file_name = f"slice_{idx:04d}.dcm"
        file_path = output_dir / file_name
        writer.SetFileName(str(file_path))
        writer.Execute(slice_img)

        instances.append({
            "index": idx,
            "sopInstanceUID": sop_uid,
            "fileName": file_name,
            "filePath": str(file_path),
            "instanceNumber": idx + 1,
            "imagePositionPatient": position,
            "sliceLocation": position[2],
            "windowCenter": window_center,
            "windowWidth": window_width,
        })

    return {
        "seriesInstanceUID": series_uid,
        "studyInstanceUID": study_uid,
        "frameOfReferenceUID": frame_of_reference_uid,
    }


def run_from_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    primary_files = sort_series_by_position([str(Path(p)) for p in cfg.get("primary", [])])
    secondary_files = sort_series_by_position([str(Path(p)) for p in cfg.get("secondary", [])])
    if not primary_files or not secondary_files:
        raise ValueError("primary and secondary file lists required")

    primary = read_series(primary_files)
    secondary = read_series(secondary_files)
    transform = load_transform(cfg)

    # Harness parity: probe representative voxels to pick the moving→fixed orientation.
    try:
        transform = pick_moving_to_fixed(primary, secondary, transform)
    except Exception:
        # Leave the original orientation if probing fails (e.g. transform not invertible).
        pass

    interpolation = cfg.get("interpolation", "linear").lower()
    interpolator = sitk.sitkLinear if interpolation != "nearest" else sitk.sitkNearestNeighbor

    # Harness parity: invert before resampling so the transform maps output→input.
    try:
        transform_for_resample = transform.GetInverse()
    except Exception:
        transform_for_resample = transform

    # FIX: Load metadata BEFORE using it
    metadata = cfg.get("metadata", {})
    
    resample_filter = sitk.ResampleImageFilter()
    resample_filter.SetReferenceImage(primary)
    resample_filter.SetTransform(transform_for_resample)
    resample_filter.SetInterpolator(interpolator)
    # Choose outside-of-FOV value by modality: CT→air(-1000), PET/MR→0
    sec_mod = str(metadata.get("secondarySeries", {}).get("Modality") or "").upper()
    default_outside = -1000.0 if sec_mod in {"CT"} else 0.0
    resample_filter.SetDefaultPixelValue(float(default_outside))
    resample_filter.SetOutputPixelType(sitk.sitkFloat32)
    resampled = resample_filter.Execute(secondary)

    output_root = Path(cfg.get("outputDirectory"))
    dicom_dir = output_root / "dicom"
    ensure_directory(output_root)
    ensure_directory(dicom_dir)

    # Optional scaling to UInt16 for export mode only
    scale_to_uint16 = bool(cfg.get("scaleToUInt16", False))
    write_image = resampled
    if scale_to_uint16:
        try:
            arr = sitk.GetArrayFromImage(resampled).astype(np.float32)
            finite = np.isfinite(arr)
            if finite.any():
                valid = arr[finite]
                vmin = float(np.min(valid))
                vmax = float(np.max(valid))
            else:
                vmin, vmax = 0.0, 1.0
            if not np.isfinite(vmin) or not np.isfinite(vmax) or vmin == vmax:
                vmin, vmax = 0.0, 1.0
        except Exception:
            vmin, vmax = 0.0, 1.0

        scale = (vmax - vmin) / 65535.0
        if scale <= 0 or not np.isfinite(scale):
            scale = 1.0
        intercept = vmin

        shifted = sitk.ShiftScale(resampled, shift=-intercept, scale=1.0 / scale)
        write_image = sitk.Cast(shifted, sitk.sitkUInt16)

        # Inject Rescale and WL into derived metadata so writers pick them up
        derived_meta = metadata.setdefault("derivedSeries", {})
        derived_meta.setdefault("WindowCenter", [(vmin + vmax) / 2.0])
        derived_meta.setdefault("WindowWidth", [max(1e-3, (vmax - vmin))])
        derived_meta["RescaleIntercept"] = float(intercept)
        derived_meta["RescaleSlope"] = float(scale)

    instances: List[Dict[str, Any]] = []
    series_info = write_dicom_series(write_image, dicom_dir, metadata, instances)

    rows = resampled.GetSize()[1]
    cols = resampled.GetSize()[0]
    depth = resampled.GetSize()[2]
    spacing = list(resampled.GetSpacing())
    pixel_spacing = [spacing[1], spacing[0]] if len(spacing) >= 2 else [1.0, 1.0]
    row_cos, col_cos = extract_orientation(resampled)
    first_pos = transform_index_to_position(resampled, (0, 0, 0))
    last_pos = transform_index_to_position(resampled, (0, 0, depth - 1)) if depth > 0 else first_pos

    derived_meta = metadata.get("derivedSeries", {})
    secondary_meta = metadata.get("secondarySeries", {})

    # Compute robust WL defaults from resampled image if metadata lacks them
    try:
        arr_stats = sitk.GetArrayFromImage(resampled).astype(np.float32)
        finite_mask = np.isfinite(arr_stats)
        if finite_mask.any():
            vals = arr_stats[finite_mask]
            p1 = float(np.percentile(vals, 1.0))
            p99 = float(np.percentile(vals, 99.0))
            if not np.isfinite(p1) or not np.isfinite(p99) or p1 == p99:
                p1, p99 = float(np.min(vals)), float(np.max(vals))
        else:
            p1, p99 = 0.0, 1.0
    except Exception:
        p1, p99 = 0.0, 1.0

    wl_center_default = (p1 + p99) / 2.0
    wl_width_default = max(1e-3, (p99 - p1))
    wl_center_out = derived_meta.get("WindowCenter") or secondary_meta.get("WindowCenter") or [wl_center_default]
    wl_width_out = derived_meta.get("WindowWidth") or secondary_meta.get("WindowWidth") or [wl_width_default]

    summary = {
        "ok": True,
        "modality": secondary_meta.get("Modality") or metadata.get("primarySeries", {}).get("Modality"),
        "seriesDescription": derived_meta.get("SeriesDescription"),
        "studyInstanceUID": series_info.get("studyInstanceUID") or metadata.get("study", {}).get("StudyInstanceUID"),
        "seriesInstanceUID": series_info.get("seriesInstanceUID"),
        "frameOfReferenceUID": series_info.get("frameOfReferenceUID") or metadata.get("primarySeries", {}).get("FrameOfReferenceUID"),
        "sliceCount": depth,
        "rows": rows,
        "columns": cols,
        "pixelSpacing": pixel_spacing,
        "imageOrientationPatient": row_cos + col_cos,
        "imagePositionPatientFirst": first_pos,
        "imagePositionPatientLast": last_pos,
        "windowCenter": wl_center_out,
        "windowWidth": wl_width_out,
        "outputDirectory": str(dicom_dir),
        "manifestPath": str(output_root / "manifest.json"),
        "instances": instances,
    }

    # Write per-run manifest for debugging
    manifest_path = output_root / "manifest.json"
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    return summary


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Fusebox volume resampler")
    parser.add_argument("--config", required=True)
    args = parser.parse_args(argv)

    config_path = Path(args.config)
    if not config_path.exists():
        print(json.dumps({"error": f"config not found: {config_path}"}))
        return 1

    cfg = json.loads(config_path.read_text())
    try:
        payload = run_from_config(cfg)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 2

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
