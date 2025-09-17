#!/usr/bin/env python3
"""
Compute per-slice DSC for the BODY ROI between a primary CT series and a secondary CT series
after applying candidate registration transforms from a DICOM REG file. This is an offline
validation script; it does not change app code.

Usage: python scripts/fusion_dsc_test.py --study 20 --primary 54 --secondary 53 \
           --rtstruct1 <path> --rtstruct2 <path> --reg <path>

If RTSTRUCT paths are omitted, it will attempt to discover them from the database.
Same for REG; it will try to find the REG in the study.
"""

import argparse
import json
import math
import os
import re
import sys
from collections import defaultdict
from typing import Dict, List, Tuple, Optional

import numpy as np
import pydicom


def load_db_env_from_dotenv(dotenv_path: str = ".env") -> Optional[str]:
    if not os.path.exists(dotenv_path):
        return None
    url = None
    with open(dotenv_path, "r") as f:
        for line in f:
            m = re.match(r"\s*DATABASE_URL\s*=\s*\"?([^\"]+)\"?\s*$", line)
            if m:
                url = m.group(1).strip()
                break
    return url


def pg_query(conn_url: str, sql: str) -> List[Tuple]:
    import psycopg
    rows: List[Tuple] = []
    with psycopg.connect(conn_url) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
    return rows


def find_series_filepaths(db_url: str, study_id: int, series_ids: List[int]) -> Dict[int, List[Dict]]:
    id_list = ",".join(str(i) for i in series_ids)
    sql = f"""
    SELECT i.id, i.series_id, i.file_path, i.file_name, i.metadata
    FROM images i
    WHERE i.series_id IN ({id_list})
    ORDER BY i.series_id, i.id
    """
    rows = pg_query(db_url, sql)
    out: Dict[int, List[Dict]] = defaultdict(list)
    for rid, sid, fp, fn, md in rows:
        out[int(sid)].append({
            'id': int(rid),
            'file_path': fp,
            'file_name': fn,
            'metadata': md if isinstance(md, dict) else json.loads(md) if md else {}
        })
    return out


def find_rtstruct_and_reg_paths(db_url: str, study_id: int) -> Tuple[List[str], Optional[str]]:
    # RTSTRUCT series in study
    sql_rt = f"""
    SELECT i.file_path
    FROM images i
    JOIN series s ON i.series_id = s.id
    WHERE s.study_id = {study_id} AND s.modality = 'RTSTRUCT'
    """
    rt_files = [r[0] for r in pg_query(db_url, sql_rt)]
    # REG in study
    sql_reg = f"""
    SELECT i.file_path
    FROM images i
    JOIN series s ON i.series_id = s.id
    WHERE s.study_id = {study_id} AND s.modality = 'REG'
    ORDER BY i.id
    LIMIT 1
    """
    reg_rows = pg_query(db_url, sql_reg)
    reg_file = reg_rows[0][0] if reg_rows else None
    return rt_files, reg_file


def parse_rt_body(rt_path: str) -> Tuple[Dict[int, List[np.ndarray]], Dict[int, str], Dict[int, str]]:
    """
    Parse RTSTRUCT and extract per-ROI-name mapping to contours by slice.
    Returns:
      - contours_by_roi: {roi_number: [ (N,3) arrays of XYZ for each contour segment ]}
      - roi_names: {roi_number: roi_name}
      - ref_series_uid_by_roi: {roi_number: referenced SeriesInstanceUID if present (first)}
    """
    ds = pydicom.dcmread(rt_path)
    roi_names: Dict[int, str] = {}
    ref_series_uid_by_roi: Dict[int, str] = {}

    # Map ROI Number to Name
    if hasattr(ds, 'StructureSetROISequence'):
        for roi in ds.StructureSetROISequence:
            roi_num = int(getattr(roi, 'ROINumber', -1))
            roi_name = str(getattr(roi, 'ROIName', f'ROI_{roi_num}'))
            roi_names[roi_num] = roi_name

    # Map ROI Number to referenced SeriesInstanceUID if available
    if hasattr(ds, 'ReferencedFrameOfReferenceSequence'):
        try:
            for rfor in ds.ReferencedFrameOfReferenceSequence:
                if hasattr(rfor, 'RTReferencedStudySequence'):
                    for rstud in rfor.RTReferencedStudySequence:
                        if hasattr(rstud, 'RTReferencedSeriesSequence'):
                            for rser in rstud.RTReferencedSeriesSequence:
                                suid = getattr(rser, 'SeriesInstanceUID', None)
                                if hasattr(rser, 'ContourImageSequence'):
                                    for ci in rser.ContourImageSequence:
                                        # Link ROI number? Not directly here.
                                        pass
                                # Fallback store at global level if mapping specific ROI is not present
                                # We will refine from ROIContourSequence below.
        except Exception:
            pass

    contours_by_roi: Dict[int, List[np.ndarray]] = defaultdict(list)
    # Extract contours and referenced SOPs, and infer SeriesInstanceUID if possible
    # The data is per ROIContourSequence
    if hasattr(ds, 'ROIContourSequence'):
        for roi_contour in ds.ROIContourSequence:
            roi_num = int(getattr(roi_contour, 'ReferencedROINumber', -1))
            # Try to capture referenced SeriesInstanceUID from ContourImageSequence items
            suid: Optional[str] = None
            if hasattr(roi_contour, 'ContourSequence'):
                for cont in roi_contour.ContourSequence:
                    data = getattr(cont, 'ContourData', None)
                    if data is None:
                        continue
                    pts = np.array(data, dtype=float).reshape(-1, 3)
                    contours_by_roi[roi_num].append(pts)
                    # Look for referenced image to deduce SeriesInstanceUID (requires DB; skip for now)
                # Store name mapping if not present
            if suid and roi_num not in ref_series_uid_by_roi:
                ref_series_uid_by_roi[roi_num] = suid

    return contours_by_roi, roi_names, ref_series_uid_by_roi


def parse_registration_matrix(reg_path: str) -> Optional[np.ndarray]:
    try:
        ds = pydicom.dcmread(reg_path)
    except Exception as e:
        print(f"Failed to read REG file {reg_path}: {e}")
        return None
    # Try RegistrationSequence -> MatrixRegistrationSequence -> MatrixSequence -> FrameOfReferenceTransformationMatrix
    mats: List[np.ndarray] = []
    try:
        if hasattr(ds, 'RegistrationSequence'):
            for reg in ds.RegistrationSequence:
                if hasattr(reg, 'MatrixRegistrationSequence'):
                    for mreg in reg.MatrixRegistrationSequence:
                        if hasattr(mreg, 'MatrixSequence'):
                            for m in mreg.MatrixSequence:
                                if hasattr(m, 'FrameOfReferenceTransformationMatrix'):
                                    vals = list(m.FrameOfReferenceTransformationMatrix)
                                    if len(vals) == 16:
                                        mats.append(np.array(vals, dtype=float).reshape(4, 4))
    except Exception:
        pass
    if not mats:
        print("No 4x4 transforms found in REG; cannot continue.")
        return None
    # Return the last one (matches viewer parser preference)
    return mats[-1]


def normalize_vec(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    if n == 0:
        return v
    return v / n


def plane_normal_from_iop(iop: List[float]) -> np.ndarray:
    r = np.array([iop[0], iop[1], iop[2]], dtype=float)
    c = np.array([iop[3], iop[4], iop[5]], dtype=float)
    n = np.cross(r, c)
    return normalize_vec(n)


def world_to_pixel(P: np.ndarray, ipp: np.ndarray, iop: List[float], pixsp: List[float]) -> Tuple[float, float]:
    # P is (3,), ipp is (3,)
    r = np.array([iop[0], iop[1], iop[2]], dtype=float)
    c = np.array([iop[3], iop[4], iop[5]], dtype=float)
    d = P - ipp
    i = np.dot(d, r) / float(pixsp[1] if len(pixsp) > 1 else pixsp[0])  # row spacing is typically second? DICOM PixelSpacing is [row, col]
    j = np.dot(d, c) / float(pixsp[0])
    # Convention: i -> rows (y), j -> cols (x)
    return float(j), float(i)


def rasterize_polygon(mask: np.ndarray, poly_px: np.ndarray):
    # Simple even-odd rule ray casting fill for a single polygon ring (no holes)
    # poly_px: (N, 2) array in pixel coords (x=j, y=i)
    h, w = mask.shape
    xs = poly_px[:, 0]
    ys = poly_px[:, 1]
    minx = max(int(np.floor(xs.min() - 1)), 0)
    maxx = min(int(np.ceil(xs.max() + 1)), w - 1)
    miny = max(int(np.floor(ys.min() - 1)), 0)
    maxy = min(int(np.ceil(ys.max() + 1)), h - 1)
    if minx >= w or miny >= h or maxx < 0 or maxy < 0:
        return
    n = len(poly_px)
    for yy in range(miny, maxy + 1):
        xints = []
        y = yy + 0.5
        for i in range(n):
            x1, y1 = poly_px[i]
            x2, y2 = poly_px[(i + 1) % n]
            if (y1 <= y < y2) or (y2 <= y < y1):
                # Compute intersection x coordinate
                t = (y - y1) / (y2 - y1)
                x = x1 + t * (x2 - x1)
                xints.append(x)
        xints.sort()
        for k in range(0, len(xints), 2):
            if k + 1 >= len(xints):
                break
            xa = int(max(math.floor(xints[k]), 0))
            xb = int(min(math.ceil(xints[k + 1]), w - 1))
            if xb >= xa:
                mask[yy, xa:xb + 1] = True


def build_body_masks_for_series(rt_contours: List[np.ndarray], img_paths: List[str]) -> Tuple[Dict[int, List[np.ndarray]], Dict[int, Dict]]:
    """
    Group BODY contours per slice index by matching to the nearest CT slice using plane value along normal.
    Returns a dictionary mapping sliceIndex -> list of polygons (world coords), and a metadata dict per slice.
    """
    # Read orientation from first image to get normal
    if not img_paths:
        return {}, {}
    ds0 = pydicom.dcmread(img_paths[0], stop_before_pixels=True)
    iop = [float(x) for x in ds0.ImageOrientationPatient]
    n = plane_normal_from_iop(iop)
    # Build slice list with plane constants
    slices = []
    for idx, p in enumerate(img_paths):
        dsi = pydicom.dcmread(p, stop_before_pixels=True)
        ipp = np.array([float(x) for x in dsi.ImagePositionPatient])
        pixsp = [float(dsi.PixelSpacing[0]), float(dsi.PixelSpacing[1])]
        rows = int(dsi.Rows)
        cols = int(dsi.Columns)
        cval = float(np.dot(n, ipp))
        slices.append({
            'index': idx,
            'path': p,
            'ipp': ipp,
            'iop': iop,
            'pixsp': pixsp,
            'rows': rows,
            'cols': cols,
            'cval': cval,
        })
    slices.sort(key=lambda s: s['cval'])

    # Group contours by nearest slice cval
    world_polys_by_slice: Dict[int, List[np.ndarray]] = defaultdict(list)
    for pts in rt_contours:
        if pts.size == 0:
            continue
        cval_cont = float(np.dot(n, pts[0]))
        best = min(slices, key=lambda s: abs(s['cval'] - cval_cont))
        world_polys_by_slice[best['index']].append(pts)
    meta_by_slice = {s['index']: s for s in slices}
    return world_polys_by_slice, meta_by_slice


def compute_dsc_per_slice(primary_world_polys: Dict[int, List[np.ndarray]],
                          secondary_world_polys: Dict[int, List[np.ndarray]],
                          meta_by_slice: Dict[int, Dict]) -> Dict[int, float]:
    dsc_by_slice: Dict[int, float] = {}
    for idx, meta in meta_by_slice.items():
        rows = meta['rows']
        cols = meta['cols']
        ipp = meta['ipp']
        iop = meta['iop']
        pixsp = meta['pixsp']
        maskA = np.zeros((rows, cols), dtype=bool)
        maskB = np.zeros((rows, cols), dtype=bool)
        for pts in primary_world_polys.get(idx, []):
            poly_px = np.array([world_to_pixel(P, ipp, iop, pixsp) for P in pts])
            rasterize_polygon(maskA, poly_px)
        for pts in secondary_world_polys.get(idx, []):
            poly_px = np.array([world_to_pixel(P, ipp, iop, pixsp) for P in pts])
            rasterize_polygon(maskB, poly_px)
        a = maskA.sum()
        b = maskB.sum()
        if a == 0 and b == 0:
            continue
        inter = np.logical_and(maskA, maskB).sum()
        dsc = 2.0 * inter / (a + b) if (a + b) > 0 else 1.0
        dsc_by_slice[idx] = dsc
    return dsc_by_slice


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--study', type=int, required=True)
    ap.add_argument('--primary', type=int, required=True, help='Primary CT series id')
    ap.add_argument('--secondary', type=int, required=True, help='Secondary CT series id')
    ap.add_argument('--rtstruct', action='append', default=[], help='RTSTRUCT DICOM path(s)')
    ap.add_argument('--reg', help='Registration DICOM path')
    args = ap.parse_args()

    db_url = os.environ.get('DATABASE_URL') or load_db_env_from_dotenv()
    if not db_url:
        print('DATABASE_URL not set and .env missing')
        sys.exit(1)

    # Discover RTSTRUCT and REG if not provided
    rt_paths = args.rtstruct
    reg_path = args.reg
    if not rt_paths or not reg_path:
        rts, reg = find_rtstruct_and_reg_paths(db_url, args.study)
        if not rt_paths:
            rt_paths = rts
        if not reg_path:
            reg_path = reg

    if not rt_paths:
        print('No RTSTRUCT files found')
        sys.exit(1)
    if not reg_path or not os.path.exists(reg_path):
        print(f'Registration file not found: {reg_path}')
        sys.exit(1)

    # Build mapping from series id to sorted image file paths
    series_files = find_series_filepaths(db_url, args.study, [args.primary, args.secondary])
    prim_paths = [rec['file_path'] for rec in series_files.get(args.primary, [])]
    sec_paths = [rec['file_path'] for rec in series_files.get(args.secondary, [])]
    if not prim_paths or not sec_paths:
        print('Missing CT images for primary or secondary series')
        sys.exit(1)

    # Parse RTSTRUCTs and find BODY per series
    body_by_series: Dict[int, List[np.ndarray]] = {args.primary: [], args.secondary: []}
    for rtp in rt_paths:
        try:
            contours_by_roi, roi_names, _ = parse_rt_body(rtp)
        except Exception as e:
            print(f'Failed to parse RTSTRUCT {rtp}: {e}')
            continue
        # Find BODY-like ROI numbers
        candidates = [rn for rn, name in roi_names.items() if name and name.strip().upper() in ('BODY', 'EXTERNAL', 'BODY CONTOUR', 'BODYCONTOUR')]
        if not candidates:
            continue
        # Heuristic: assign to a series by checking proximity of Z to the series planes
        # Compute cval list for each series
        def slice_cvals(paths: List[str]) -> List[float]:
            d0 = pydicom.dcmread(paths[0], stop_before_pixels=True)
            iop = [float(x) for x in d0.ImageOrientationPatient]
            n = plane_normal_from_iop(iop)
            vals = []
            for p in paths:
                di = pydicom.dcmread(p, stop_before_pixels=True)
                ipp = np.array([float(x) for x in di.ImagePositionPatient])
                vals.append(float(np.dot(n, ipp)))
            return sorted(vals)
        prim_cvals = slice_cvals(prim_paths)
        sec_cvals = slice_cvals(sec_paths)
        # Collect all BODY contours points and average plane value to decide attachment
        for rn in candidates:
            cnts = contours_by_roi.get(rn, [])
            if not cnts:
                continue
            cvals = []
            for pts in cnts:
                cvals.append(float(np.mean(pts[:, 2])))  # rough
            if not cvals:
                continue
            avg = float(np.median(cvals))
            # Compare distance to median plane of each series
            def median_dist(vals: List[float], a: float) -> float:
                if not vals:
                    return float('inf')
                return float(min(abs(v - a) for v in vals))
            dprim = median_dist(prim_cvals, avg)
            dsec = median_dist(sec_cvals, avg)
            target_sid = args.primary if dprim <= dsec else args.secondary
            body_by_series[target_sid].extend(cnts)

    if not body_by_series[args.primary] or not body_by_series[args.secondary]:
        print('Could not locate BODY contours for both primary and secondary series')
        sys.exit(1)

    # Build per-slice grouping of BODY for primary
    prim_world, prim_meta = build_body_masks_for_series(body_by_series[args.primary], prim_paths)

    # Parse registration transform
    baseM = parse_registration_matrix(reg_path)
    if baseM is None:
        sys.exit(1)

    # Candidate variants
    def flat(m: np.ndarray) -> np.ndarray:
        return m.reshape(4, 4)
    Mt = baseM.T
    try:
        Minv = np.linalg.inv(baseM)
    except Exception:
        Minv = baseM
    try:
        MinvT = np.linalg.inv(Mt)
    except Exception:
        MinvT = Mt
    variants = {
        'M': baseM,
        'MT': Mt,
        'MINV': Minv,
        'MINVT': MinvT,
    }

    # For each variant, transform secondary BODY polygons into primary world, group per slice, compute DSC
    results = []
    for name, M in variants.items():
        sec_transformed = []
        for pts in body_by_series[args.secondary]:
            ones = np.ones((pts.shape[0], 1), dtype=float)
            hom = np.hstack([pts, ones])
            out = hom @ M.T
            sec_transformed.append(out[:, :3])
        sec_world_by_slice, _ = build_body_masks_for_series(sec_transformed, prim_paths)
        dsc_by_slice = compute_dsc_per_slice(prim_world, sec_world_by_slice, prim_meta)
        if not dsc_by_slice:
            passed = 0
            frac = 0.0
            dmin = 0.0
            davg = 0.0
        else:
            ds = list(dsc_by_slice.values())
            passed = sum(1 for d in ds if d >= 0.98)
            frac = passed / len(ds)
            dmin = float(np.min(ds))
            davg = float(np.mean(ds))
        results.append((name, passed, frac, dmin, davg))

    # Report summary
    print("Variant, passed_slices, pass_fraction, min_dsc, avg_dsc")
    for name, passed, frac, dmin, davg in results:
        print(f"{name}, {passed}, {frac:.3f}, {dmin:.3f}, {davg:.3f}")


if __name__ == '__main__':
    try:
        import psycopg  # for db access
    except ImportError:
        print('Installing psycopg for database access...')
        os.system(sys.executable + ' -m pip install --quiet psycopg[binary] > /dev/null 2>&1')
    main()

