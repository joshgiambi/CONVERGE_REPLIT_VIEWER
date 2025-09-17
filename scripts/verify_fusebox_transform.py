#!/usr/bin/env python3
"""Verify Fusebox helper output against raw DICOM registration matrices.

The script resamples a slice using both the raw 4x4 affine found in the
registration DICOM and the `.h5` produced by `dicom_reg_to_h5`. It asserts that
both approaches yield matching voxel data and that the helper's affine matches
Eclipse's (fixed→moving) convention within a configurable tolerance.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

import numpy as np
import pydicom
import SimpleITK as sitk

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from fusebox_resample import run_from_config  # type: ignore  # noqa: E402

DEFAULT_PRIMARY_DIR = Path(
    "storage/patients/POSITRON_07/"
    "2.16.840.1.114362.1.12021633.23213054100.592378074.712.831/"
    "2.16.840.1.114362.1.12021633.23213054100.592378074.720.834"
)
DEFAULT_SECONDARY_DIR = Path(
    "storage/patients/POSITRON_07/"
    "2.16.840.1.114362.1.12021633.23213054100.592378074.712.831/"
    "2.16.840.1.114362.1.12021633.23213054100.592378074.135.744"
)
DEFAULT_REGISTRATION = Path(
    "storage/patients/POSITRON_07/"
    "2.16.840.1.114362.1.12021633.23213054100.592378074.712.831/"
    "2.16.840.1.114362.1.12021633.23213054100.592378074.713.832/"
    "2.16.840.1.114362.1.12021633.23213054100.592378074.712.830.dcm"
)


def collect_dicom_files(directory: Path) -> List[str]:
    files = sorted(str(p) for p in directory.glob("*.dcm"))
    if not files:
        raise FileNotFoundError(f"No DICOM files found in {directory}")
    return files


def read_frame_of_reference(dicom_path: str) -> str:
    dataset = pydicom.dcmread(dicom_path, stop_before_pixels=True)
    if not hasattr(dataset, "FrameOfReferenceUID"):
        raise ValueError(f"DICOM {dicom_path} missing FrameOfReferenceUID")
    return str(dataset.FrameOfReferenceUID)


def load_registration_matrix(reg_path: Path) -> Sequence[float]:
    dataset = pydicom.dcmread(str(reg_path))
    candidates: List[Sequence[float]] = []
    if hasattr(dataset, "RegistrationSequence"):
        for registration in dataset.RegistrationSequence:
            matrix_seq = getattr(registration, "MatrixRegistrationSequence", [])
            for matrix_reg in matrix_seq:
                matrices = getattr(matrix_reg, "MatrixSequence", [])
                for mat in matrices:
                    raw = [float(v) for v in mat.FrameOfReferenceTransformationMatrix]
                    candidates.append(raw)
    if not candidates:
        raise ValueError(f"No transformation matrices found in {reg_path}")

    # Prefer the last non-identity candidate to mirror server/REG parser logic.
    for values in reversed(candidates):
        mat = np.array(values, dtype=float).reshape(4, 4)
        if not np.allclose(mat, np.eye(4)):
            return values
    return candidates[-1]


def ensure_transform_file(helper: Path | None,
                          reg_path: Path,
                          fixed_for: str,
                          moving_for: str,
                          output_path: Path) -> None:
    if output_path.exists():
        return
    if helper is None:
        raise RuntimeError("dicom_reg_to_h5 binary path required to build transform")
    cmd = [
        str(helper),
        "--input", str(reg_path),
        "--output", str(output_path),
        "--fixed", fixed_for,
        "--moving", moving_for,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"Helper failed with exit {result.returncode}: {result.stderr or result.stdout}"
        )


def decode_slice(payload: dict) -> np.ndarray:
    raw = base64.b64decode(payload["data"])
    return np.frombuffer(raw, dtype="<f4")


def matrix_from_transform(transform: sitk.Transform) -> np.ndarray:
    origin = np.array(transform.TransformPoint((0.0, 0.0, 0.0)))
    axes = [
        np.array(transform.TransformPoint((1.0, 0.0, 0.0))) - origin,
        np.array(transform.TransformPoint((0.0, 1.0, 0.0))) - origin,
        np.array(transform.TransformPoint((0.0, 0.0, 1.0))) - origin,
    ]
    matrix = np.eye(4)
    for idx, axis in enumerate(axes):
        matrix[:3, idx] = axis
    matrix[:3, 3] = origin
    return matrix


def compare_affines(expected: np.ndarray,
                    observed: np.ndarray,
                    rotation_tol: float,
                    translation_tol: float) -> None:
    rot_diff = np.max(np.abs(expected[:3, :3] - observed[:3, :3]))
    trans_diff = float(np.linalg.norm(expected[:3, 3] - observed[:3, 3]))
    if rot_diff <= rotation_tol and trans_diff <= translation_tol:
        return

    # Check whether the helper wrote the inverse; surface a clearer error.
    inverse = np.linalg.inv(observed)
    rot_inv = np.max(np.abs(expected[:3, :3] - inverse[:3, :3]))
    trans_inv = float(np.linalg.norm(expected[:3, 3] - inverse[:3, 3]))
    if rot_inv <= rotation_tol and trans_inv <= translation_tol:
        raise AssertionError(
            "Helper transform appears inverted relative to DICOM matrix."
        )
    raise AssertionError(
        f"Helper transform mismatch (rotation diff {rot_diff:.4g}, translation diff {trans_diff:.4g}mm)"
    )


def verify(args: argparse.Namespace) -> None:
    primary_dir = Path(args.primary_dir)
    secondary_dir = Path(args.secondary_dir)
    reg_path = Path(args.registration)
    helper_path: Path | None = Path(args.helper) if args.helper else None

    primary_files = collect_dicom_files(primary_dir)
    secondary_files = collect_dicom_files(secondary_dir)

    fixed_for = read_frame_of_reference(primary_files[0])
    moving_for = read_frame_of_reference(secondary_files[0])

    matrix_values = load_registration_matrix(reg_path)
    matrix_np = np.array(matrix_values, dtype=float).reshape(4, 4)

    transform_path: Path
    remove_transform = False
    if args.transform_file:
        transform_path = Path(args.transform_file)
    else:
        handle = tempfile.NamedTemporaryFile(suffix=".h5", delete=False)
        transform_path = Path(handle.name)
        handle.close()
        transform_path.unlink(missing_ok=True)  # Allow helper to create the file
        remove_transform = True

    ensure_transform_file(helper_path, reg_path, fixed_for, moving_for, transform_path)

    helper_transform = sitk.ReadTransform(str(transform_path))
    helper_matrix = matrix_from_transform(helper_transform)
    compare_affines(matrix_np, helper_matrix, args.rotation_tolerance, args.translation_tolerance)

    resample_kwargs = {
        "primary": primary_files,
        "secondary": secondary_files,
        "sliceIndex": args.slice_index,
        "interpolation": args.interpolation,
    }
    slice_matrix = run_from_config({**resample_kwargs, "transform": matrix_values})
    slice_helper = run_from_config({**resample_kwargs, "transformFile": str(transform_path)})

    voxels_matrix = decode_slice(slice_matrix)
    voxels_helper = decode_slice(slice_helper)
    if voxels_matrix.shape != voxels_helper.shape:
        raise AssertionError("Resampled arrays differ in size")
    voxel_diff = float(np.max(np.abs(voxels_matrix - voxels_helper)))
    if voxel_diff > args.slice_tolerance:
        raise AssertionError(
            f"Resampled slice mismatch (max voxel diff {voxel_diff:.4g} > {args.slice_tolerance})"
        )

    if remove_transform and transform_path.exists():
        transform_path.unlink(missing_ok=True)  # type: ignore[arg-type]

    print(
        "✔ Fusebox helper matches DICOM matrix. "
        f"Rotation max diff {np.max(np.abs(matrix_np[:3, :3] - helper_matrix[:3, :3])):.4g}, "
        f"translation diff {np.linalg.norm(matrix_np[:3, 3] - helper_matrix[:3, 3]):.4g} mm, "
        f"slice max diff {voxel_diff:.4g}."
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate dicom_reg_to_h5 parity")
    parser.add_argument(
        "--primary-dir",
        default=str(DEFAULT_PRIMARY_DIR),
        help=f"Directory containing fixed/CT DICOM files (default: {DEFAULT_PRIMARY_DIR})",
    )
    parser.add_argument(
        "--secondary-dir",
        default=str(DEFAULT_SECONDARY_DIR),
        help=f"Directory containing moving/PET DICOM files (default: {DEFAULT_SECONDARY_DIR})",
    )
    parser.add_argument(
        "--registration",
        default=str(DEFAULT_REGISTRATION),
        help=f"Path to the REG DICOM (default: {DEFAULT_REGISTRATION})",
    )
    parser.add_argument("--transform-file", help="Existing helper output (.h5). If omitted the helper is executed")
    parser.add_argument("--helper", default=os.environ.get("DICOM_REG_CONVERTER"), help="Path to dicom_reg_to_h5 binary")
    parser.add_argument("--slice-index", type=int, default=0, help="Slice index to validate (default: 0)")
    parser.add_argument("--interpolation", default="linear", choices=["linear", "nearest"], help="Interpolation used for resampling")
    parser.add_argument("--rotation-tolerance", type=float, default=1e-3, help="Maximum allowed rotation element difference")
    parser.add_argument("--translation-tolerance", type=float, default=0.5, help="Maximum allowed translation difference (mm)")
    parser.add_argument("--slice-tolerance", type=float, default=5e-3, help="Maximum allowed voxel difference between slices")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    verify(args)


if __name__ == "__main__":
    main()
