#!/usr/bin/env python3
"""Inspect a SimpleITK transform and report forward/inverse parameters."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List

import SimpleITK as sitk


def affine_to_matrix(transform: sitk.AffineTransform) -> List[float]:
    matrix = list(transform.GetMatrix())
    translation = list(transform.GetTranslation())
    return [
        matrix[0], matrix[1], matrix[2], translation[0],
        matrix[3], matrix[4], matrix[5], translation[1],
        matrix[6], matrix[7], matrix[8], translation[2],
        0.0, 0.0, 0.0, 1.0,
    ]


def is_identity_transform(transform: sitk.Transform) -> bool:
    """Check if a transform is effectively an identity transform."""
    try:
        if isinstance(transform, sitk.CompositeTransform):
            # Check if all parameters are identity-like
            params = list(transform.GetParameters())
            # For CompositeTransform, identity parameters are typically all zeros or identity matrix elements
            return all(abs(p) < 1e-6 for p in params)
        elif hasattr(transform, 'GetMatrix'):
            # For transforms with matrices, check if it's identity
            matrix = list(transform.GetMatrix())
            translation = list(transform.GetTranslation()) if hasattr(transform, 'GetTranslation') else [0, 0, 0]
            identity_matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]
            return (all(abs(matrix[i] - identity_matrix[i]) < 1e-6 for i in range(len(matrix))) and
                    all(abs(t) < 1e-6 for t in translation))
        else:
            # For other transforms, check if parameters are near zero
            params = list(transform.GetParameters())
            return all(abs(p) < 1e-6 for p in params)
    except:
        return False

def extract_meaningful_transforms(transform: sitk.Transform, max_depth: int = 10) -> List[sitk.Transform]:
    """Extract meaningful (non-identity) transforms from a potentially nested composite."""
    meaningful = []
    
    def extract_recursive(t: sitk.Transform, depth: int = 0):
        if depth > max_depth:
            return
        
        if isinstance(t, sitk.CompositeTransform):
            size = t.GetNumberOfTransforms()
            for idx in range(min(size, 20)):  # Reasonable limit
                try:
                    child = t.GetNthTransform(idx)
                    if not is_identity_transform(child):
                        if isinstance(child, sitk.CompositeTransform):
                            extract_recursive(child, depth + 1)
                        else:
                            meaningful.append(child)
                except:
                    continue
        elif not is_identity_transform(t):
            meaningful.append(t)
    
    extract_recursive(transform)
    return meaningful

def serialize_transform(transform: sitk.Transform, depth: int = 0, max_depth: int = 5) -> dict:
    """Serialize a transform with recursion protection and meaningful transform extraction."""
    if depth > max_depth:
        return {
            "type": "RecursionLimitExceeded",
            "error": f"Maximum recursion depth ({max_depth}) exceeded",
            "parameters": [],
            "fixedParameters": [],
        }
    
    payload = {
        "type": transform.GetName(),
        "parameters": list(transform.GetParameters()),
        "fixedParameters": list(transform.GetFixedParameters()),
    }

    if isinstance(transform, sitk.AffineTransform):
        payload["matrix4x4"] = affine_to_matrix(transform)

    if isinstance(transform, sitk.CompositeTransform):
        size = transform.GetNumberOfTransforms()
        
        # Extract meaningful transforms to provide a cleaner view
        meaningful_transforms = extract_meaningful_transforms(transform)
        if meaningful_transforms:
            payload["meaningfulTransforms"] = []
            for mt in meaningful_transforms[:5]:  # Limit to 5 meaningful transforms
                payload["meaningfulTransforms"].append({
                    "type": mt.GetName(),
                    "parameters": list(mt.GetParameters()),
                    "fixedParameters": list(mt.GetFixedParameters()),
                    "matrix4x4": affine_to_matrix(mt) if isinstance(mt, sitk.AffineTransform) else None
                })
        
        children = []
        for idx in range(min(size, 5)):  # Reduced limit for cleaner output
            try:
                child = transform.GetNthTransform(idx)
                children.append(serialize_transform(child, depth + 1, max_depth))
            except Exception as e:
                children.append({
                    "type": "TransformAccessError", 
                    "error": str(e),
                    "index": idx,
                    "parameters": [],
                    "fixedParameters": [],
                })
        if size > 5:
            children.append({
                "type": "TruncatedChildren",
                "error": f"Truncated {size - 5} additional child transforms",
                "parameters": [],
                "fixedParameters": [],
            })
        payload["children"] = children
        payload["childCount"] = size

    return payload


def inspect(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Transform not found: {path}")

    transform = sitk.ReadTransform(str(path))
    inverse = transform.GetInverse()

    payload = serialize_transform(transform)
    payload["inverse"] = serialize_transform(inverse)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect a fusebox transform")
    parser.add_argument("transform", help="Path to transform .h5 file")
    args = parser.parse_args()

    path = Path(args.transform)
    try:
        payload = inspect(path)
        print(json.dumps({"ok": True, "payload": payload}))
        return 0
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
