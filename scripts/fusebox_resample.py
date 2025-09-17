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
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import SimpleITK as sitk

try:  # pragma: no cover - optional dependency
    from pydicom.uid import generate_uid as pydicom_generate_uid
except Exception:  # pragma: no cover - fallback when pydicom unavailable
    pydicom_generate_uid = None


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


def generate_dicom_uid() -> str:
    if pydicom_generate_uid is not None:
        try:
            return pydicom_generate_uid()
        except Exception:
            pass
    return f"2.25.{uuid.uuid4().int}"


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


def collect_metadata(file_path: str, keys: Sequence[str]) -> Dict[str, str]:
    reader = sitk.ImageFileReader()
    reader.SetFileName(str(file_path))
    reader.LoadPrivateTagsOn()
    reader.ReadImageInformation()
    meta: Dict[str, str] = {}
    for key in keys:
        if reader.HasMetaDataKey(key):
            meta[key] = reader.GetMetaData(key)
    return meta


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
            # Try flattening the original transform directly
            xform.FlattenTransformQueue()
            print(f"🐟 FUSION: After flattening original: {xform.GetNumberOfTransforms()} transforms", file=sys.stderr)
            
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
    """Fusebox consumes moving→fixed transforms; invert when needed."""
    try:
        return xform.GetInverse()
    except RuntimeError as exc:  # pragma: no cover
        raise ValueError("Transform is not invertible") from exc


def resample(
    primary: sitk.Image,
    secondary: sitk.Image,
    xform: sitk.Transform,
    interpolation: str,
    output_pixel_type: int = sitk.sitkFloat32,
) -> sitk.Image:
    resample_filter = sitk.ResampleImageFilter()
    resample_filter.SetReferenceImage(primary)
    resample_filter.SetTransform(xform)
    if interpolation.lower() == "nearest":
        resample_filter.SetInterpolator(sitk.sitkNearestNeighbor)
    else:
        resample_filter.SetInterpolator(sitk.sitkLinear)
    resample_filter.SetDefaultPixelValue(0.0)
    resample_filter.SetOutputPixelType(output_pixel_type)
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


def write_derived_series(
    image: sitk.Image,
    reference_primary: sitk.Image,
    primary_files: Sequence[str],
    secondary_files: Sequence[str],
    output_dir: str,
    metadata_options: Optional[dict] = None,
) -> dict:
    metadata_options = metadata_options or {}
    dest = Path(output_dir)
    dest.mkdir(parents=True, exist_ok=True)

    # Remove stale DICOM slices before writing a fresh series
    for existing in dest.glob('*.dcm'):
        try:
            existing.unlink()
        except Exception as exc:  # pragma: no cover - diagnostic
            print(f"🐟 FUSION: Unable to remove stale file {existing}: {exc}", file=sys.stderr)

    primary_keys = [
        "0008|0005", "0008|0020", "0008|0030", "0008|0050", "0008|0080",
        "0008|0090", "0008|1030", "0008|103e", "0010|0010", "0010|0020",
        "0010|0030", "0010|0040", "0018|5100", "0020|000d", "0020|0052",
    ]
    secondary_keys = [
        "0008|0016", "0008|0060", "0008|103e", "0028|0002", "0028|0004",
        "0028|0100", "0028|0101", "0028|0102", "0028|0103", "0028|1052",
        "0028|1053", "0028|0106", "0028|0107",
    ]

    primary_meta = collect_metadata(primary_files[0], primary_keys) if primary_files else {}
    secondary_meta = collect_metadata(secondary_files[0], secondary_keys) if secondary_files else {}

    modality = (
        metadata_options.get("modality")
        or secondary_meta.get("0008|0060")
        or "OT"
    )
    sop_class_uid = secondary_meta.get("0008|0016", "1.2.840.10008.5.1.4.1.1.2")
    study_instance_uid = metadata_options.get("studyInstanceUID") or primary_meta.get("0020|000d")
    frame_of_reference = metadata_options.get("frameOfReferenceUID") or primary_meta.get("0020|0052")
    patient_id = metadata_options.get("patientId") or primary_meta.get("0010|0020")
    patient_name = metadata_options.get("patientName") or primary_meta.get("0010|0010")
    patient_birth = metadata_options.get("patientBirthDate") or primary_meta.get("0010|0030")
    patient_sex = metadata_options.get("patientSex") or primary_meta.get("0010|0040")
    charset = metadata_options.get("specificCharacterSet") or primary_meta.get("0008|0005")
    series_uid = metadata_options.get("seriesInstanceUID") or generate_dicom_uid()

    secondary_description = secondary_meta.get("0008|103e") or metadata_options.get("secondaryDescription")
    primary_description = primary_meta.get("0008|103e") or metadata_options.get("primaryDescription")
    description_suffix = metadata_options.get("seriesDescriptionSuffix")

    derived_description_parts = [secondary_description or f"{modality} Derived"]
    if description_suffix:
        derived_description_parts.append(str(description_suffix))
    elif primary_description:
        derived_description_parts.append(f"→ {primary_description}")
    series_description = " ".join(part for part in derived_description_parts if part)

    derivation_description = metadata_options.get("derivationDescription")
    if not derivation_description:
        reg_id = metadata_options.get("registrationId")
        secondary_uid = metadata_options.get("secondarySeriesInstanceUID")
        primary_uid = metadata_options.get("primarySeriesInstanceUID")
        derivation_description = (
            "Fusebox rigid resample"
            + (f" from {secondary_uid}" if secondary_uid else "")
            + (f" to {primary_uid}" if primary_uid else "")
            + (f" (registration {reg_id})" if reg_id else "")
        ).strip()

    size = image.GetSize()
    spacing = image.GetSpacing()
    origin = image.GetOrigin()
    direction = reference_primary.GetDirection() if reference_primary else image.GetDirection()
    row_dir = direction[:3]
    col_dir = direction[3:6]
    orientation_value = '\\'.join(f"{v:.12f}" for v in (*row_dir, *col_dir))
    pixel_spacing_value = '\\'.join(f"{spacing[i]:.12f}" for i in range(2))
    slice_thickness_value = f"{spacing[2]:.12f}"

    writer = sitk.ImageSeriesWriter()
    file_names = [str(dest / f"{index + 1:05d}.dcm") for index in range(size[2])]
    writer.SetFileNames(file_names)
    writer.SetUseCompression(True)

    sop_instance_uids: List[str] = []
    for index in range(size[2]):
        sop_uid = generate_dicom_uid()
        sop_instance_uids.append(sop_uid)
        z_position = image.TransformIndexToPhysicalPoint((0, 0, index))
        position_value = '\\'.join(f"{coord:.12f}" for coord in z_position)

        writer.SetMetaData(index, "0008|0008", "DERIVED\\SECONDARY")
        writer.SetMetaData(index, "0008|0016", sop_class_uid)
        writer.SetMetaData(index, "0008|0018", sop_uid)
        writer.SetMetaData(index, "0008|0060", modality)
        if series_description:
            writer.SetMetaData(index, "0008|103e", series_description)
        if derivation_description:
            writer.SetMetaData(index, "0008|2111", derivation_description)
        if charset:
            writer.SetMetaData(index, "0008|0005", charset)
        if study_instance_uid:
            writer.SetMetaData(index, "0020|000d", study_instance_uid)
        writer.SetMetaData(index, "0020|000e", series_uid)
        writer.SetMetaData(index, "0020|0013", str(index + 1))
        writer.SetMetaData(index, "0020|0032", position_value)
        writer.SetMetaData(index, "0020|0037", orientation_value)
        if frame_of_reference:
            writer.SetMetaData(index, "0020|0052", frame_of_reference)
        if patient_id:
            writer.SetMetaData(index, "0010|0020", patient_id)
        if patient_name:
            writer.SetMetaData(index, "0010|0010", patient_name)
        if patient_birth:
            writer.SetMetaData(index, "0010|0030", patient_birth)
        if patient_sex:
            writer.SetMetaData(index, "0010|0040", patient_sex)
        if primary_meta.get("0008|0020"):
            writer.SetMetaData(index, "0008|0020", primary_meta["0008|0020"])
        if primary_meta.get("0008|0030"):
            writer.SetMetaData(index, "0008|0030", primary_meta["0008|0030"])
        if primary_meta.get("0018|5100"):
            writer.SetMetaData(index, "0018|5100", primary_meta["0018|5100"])
        if primary_meta.get("0008|0080"):
            writer.SetMetaData(index, "0008|0080", primary_meta["0008|0080"])
        if primary_meta.get("0008|0090"):
            writer.SetMetaData(index, "0008|0090", primary_meta["0008|0090"])

        writer.SetMetaData(index, "0028|0008", str(size[2]))
        writer.SetMetaData(index, "0028|0010", str(size[1]))
        writer.SetMetaData(index, "0028|0011", str(size[0]))
        writer.SetMetaData(index, "0028|0030", pixel_spacing_value)
        writer.SetMetaData(index, "0018|0050", slice_thickness_value)
        writer.SetMetaData(index, "0018|0088", slice_thickness_value)

        for tag in ("0028|0002", "0028|0004", "0028|0100", "0028|0101", "0028|0102", "0028|0103", "0028|0106", "0028|0107", "0028|1052", "0028|1053"):
            value = secondary_meta.get(tag)
            if value is not None:
                writer.SetMetaData(index, tag, value)

    writer.Execute(image)

    return {
        "directory": str(dest),
        "seriesInstanceUID": series_uid,
        "files": [Path(name).name for name in file_names],
        "sopInstanceUIDs": sop_instance_uids,
        "modality": modality,
        "sliceCount": size[2],
        "pixelSpacing": [float(spacing[0]), float(spacing[1])],
        "sliceThickness": float(spacing[2]) if len(spacing) > 2 else None,
        "frameOfReferenceUID": frame_of_reference,
        "studyInstanceUID": study_instance_uid,
        "seriesDescription": series_description,
        "derivationDescription": derivation_description,
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
    derived_series_dir = cfg.get("writeSeriesDir")
    derived_series_metadata = cfg.get("seriesMetadata") or {}

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

    print(f"🐟 FUSION: Starting resampling with {xform.GetName()}", file=sys.stderr)
    print(f"🐟 FUSION: Primary image size: {primary.GetSize()}", file=sys.stderr)
    print(f"🐟 FUSION: Secondary image size: {secondary.GetSize()}", file=sys.stderr)

    try:
        resampled = resample(primary, secondary, xform, interpolation)
        print(f"🐟 FUSION: Resampling successful, output size: {resampled.GetSize()}", file=sys.stderr)
    except Exception as e:
        print(f"🐟 FUSION: Resampling failed: {e}", file=sys.stderr)
        raise

    derived_info = None
    if derived_series_dir:
        try:
            native_cast = sitk.Cast(resampled, secondary.GetPixelID())
            derived_info = write_derived_series(
                native_cast,
                primary,
                primary_files,
                secondary_files,
                derived_series_dir,
                derived_series_metadata,
            )
            print(
                f"🐟 FUSION: Derived series written to {derived_info['directory']} ({derived_info['sliceCount']} slices)",
                file=sys.stderr,
            )
        except Exception as exc:
            print(f"🐟 FUSION: Failed to write derived series: {exc}", file=sys.stderr)
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
        payload = {
            "sliceIndex": slice_index,
            "primary": encode_slice(primary_slice),
            "secondary": encode_slice(resampled_slice),
            "blend": encode_slice(blend_slice),
        }
        if derived_info:
            payload["derivedSeries"] = derived_info
        return payload

    result = encode_slice(resampled_slice)
    if derived_info:
        result["derivedSeries"] = derived_info
    return result


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
