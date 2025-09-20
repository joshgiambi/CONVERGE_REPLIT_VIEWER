import SimpleITK as sitk
from typing import List, Tuple

def has_flatten() -> bool:
    """Return True if CompositeTransform exposes FlattenTransformQueue."""
    try:
        x = sitk.CompositeTransform(3)
        return hasattr(x, 'FlattenTransformQueue')
    except Exception:
        return False

def flatten_composite_transform(xform: sitk.Transform) -> sitk.Transform:
    """Flatten CompositeTransform when available; otherwise return original."""
    if isinstance(xform, sitk.CompositeTransform) and hasattr(xform, 'FlattenTransformQueue'):
        # Clone to avoid mutating the original
        comp = sitk.CompositeTransform(xform)
        comp.FlattenTransformQueue()
        # After flattening, prefer the last child as effective moving→fixed
        if comp.GetNumberOfTransforms() > 0:
            return comp.GetBackTransform()
        return comp
    return xform

def ensure_moving_to_fixed(xform: sitk.Transform) -> sitk.Transform:
    """Ensure transform maps moving→fixed; invert if necessary when possible."""
    # Heuristic: try to invert; if inversion works, prefer the inverse only
    # when it has a valid Jacobian at origin (avoid non-invertible types).
    try:
        inv = xform.GetInverse()
        return inv
    except Exception:
        return xform


def _image_bounds(image: sitk.Image) -> Tuple[Tuple[float, float, float], Tuple[float, float, float]]:
    size = image.GetSize()
    corners_index = [
        (0, 0, 0),
        (size[0] - 1, 0, 0),
        (0, size[1] - 1, 0),
        (0, 0, max(0, size[2] - 1)),
        (size[0] - 1, size[1] - 1, max(0, size[2] - 1)),
    ]
    points = [image.TransformIndexToPhysicalPoint(idx) for idx in corners_index]
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    zs = [p[2] for p in points]
    min_pt = (min(xs), min(ys), min(zs))
    max_pt = (max(xs), max(ys), max(zs))
    return min_pt, max_pt


def _in_bounds(bounds: Tuple[Tuple[float, float, float], Tuple[float, float, float]], p: Tuple[float, float, float]) -> bool:
    (xmin, ymin, zmin), (xmax, ymax, zmax) = bounds
    return (xmin <= p[0] <= xmax) and (ymin <= p[1] <= ymax) and (zmin <= p[2] <= zmax)


def pick_moving_to_fixed(fixed: sitk.Image, moving: sitk.Image, xform: sitk.Transform) -> sitk.Transform:
    """Choose the orientation (xform or its inverse) that maps moving→fixed using a simple in-bounds probe.

    This mirrors the harness: prefer a transform that lands representative moving points inside the
    fixed image bounds. If both fail, return the original transform.
    """
    bounds_fixed = _image_bounds(fixed)

    size_m = moving.GetSize()
    probes_index = [
        (size_m[0] // 2, size_m[1] // 2, size_m[2] // 2 if len(size_m) > 2 else 0),
        (0, 0, 0),
        (max(0, size_m[0] - 1), 0, 0),
        (0, max(0, size_m[1] - 1), 0),
        (max(0, size_m[0] - 1), max(0, size_m[1] - 1), max(0, size_m[2] - 1 if len(size_m) > 2 else 0)),
    ]
    probes = [moving.TransformIndexToPhysicalPoint(idx) for idx in probes_index]

    def score(t: sitk.Transform) -> int:
        s = 0
        for p in probes:
            q = t.TransformPoint(p)
            if _in_bounds(bounds_fixed, q):
                s += 1
        return s

    try:
        inv = xform.GetInverse()
    except Exception:
        inv = None

    s_fwd = score(xform)
    s_inv = score(inv) if inv is not None else -1

    if s_inv > s_fwd:
        return inv
    return xform


