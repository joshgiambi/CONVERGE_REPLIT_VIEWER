# Interpolation Parity Progress Log

Status: in-progress. Goal is DSC ≥ 0.98 for all TARGET1_INTERP slices (ideally 1.0).

## Completed Work

- SDT-based interpolation with multi-loop union and area-matched thresholding.
- Robust marching-squares loop assembly; centroid-based loop selection.
- Viewer integration (CT-grid targeting), smooth-min blending, small morphological closing; polar fallback.
- Raster validator comparing our interpolation to Eclipse TARGET1_INTERP in voxel space (no polygon fragility), with adaptive grid for small shapes.

Validator entry: `scripts/validate-target1-interp.ts`

## Current Validator Modes (env flags)

- `BLEND_MODE`: `linear` | `smoothmin` | `polar` | `best` (default `best`)
- Area-match threshold with optional in-threshold closing (diamond/square)
- Smooth-min params: `SM_ALPHA_MM`, `SM_ALPHA_MM_LIST`
- Closing params: `CLOSING_MM`, `CLOSING_MM_LIST`, `closingShape` (diamond/square via code paths)
- Lp SDF blend: `LP_P_LIST` (p in [0.8..1.5])
- Cone blend (z-aware min with offsets): `CONE_K_LIST` (k in [0.5..3])

## Results Snapshot (TARGET1 vs TARGET1_INTERP)

- Many slices ≥ 0.98–0.996.
- Worst slices (z ≈ 8–22 mm) remain low (≈ 0.49–0.66), mean ≈ 0.87.
- Best-of across linear, smooth-min(+closing), Lp, cone, polar, L1/L∞ union-of-dilations, Euclidean cone-union, and 3D MCI (object vs background distance competition) did not fix worst slices.

## What Failed (so far)

1) Linear SDT blend with area-matched threshold: leaves a “crosshair/saddle” in crossing bands.
2) Smooth-min (varied alpha) + small morphological closing (square/diamond): improves edges but crosshair persists; worst DSC unchanged.
3) Polar interpolation: slightly degrades mean; worst unchanged.
4) Lp SDF blending (p ∈ {0.8, 1.0, 1.2, 1.5}): no meaningful lift on worst slices.
5) Cone (z-aware min with offsets): no improvement on worst slices.
6) Threshold-in-the-loop closing (closing during area match search): still no fix.
7) L1/L∞ union-of-dilations + Euclidean cone-union (area-matched): did not beat SDT on worst slices.
8) MCI-3D (object/background seed distance competition with anisotropic 3D hypot): still does not lift crossing-band DSC beyond ~0.66.

## Why It Likely Fails

The troublesome slices appear to be orthogonal band crossings. Our current 2D field blends—even with closing—tend to produce cross-like iso-topology, while Eclipse’s shapes are closer to diamond/convex centers in those crossings. Cosmetic closing does not alter the field topology enough.

## Next Steps (planned)

- Implemented pivot + piecewise SDT in the viewer: synthesize a simple middle-ground (pivot) via Euclidean cone-union area-matched at mid‑slice, then blend SDT A→pivot for lower half and pivot→B for upper half, with per‑half area‑matched thresholds and optional closing.
- Additional candidates to consider next:
  - Field‑blurred SDT: tiny Gaussian blur (0.3–0.6 mm) on the blended field prior to threshold, then area‑match tau.
  - Squared‑SDF blend: blend squared SDFs before square‑root + sign, then area‑match.
  - Perimeter‑aware tau: choose threshold to meet both area and perimeter targets linearly interpolated between slices.
  - Orientation‑aware morphological union: apply a small in‑plane shear/rotation only in detected crossing slices to align the diamond metric with band axes.

## How to Run

1) Start server: `PORT=5175 npm run dev`
2) Validate: `BASE=http://localhost:5175 BLEND_MODE=best npm run validate:target1`
3) Optional sweeps:
   - `CLOSING_MM_LIST='0,0.6,1.2' SM_ALPHA_MM_LIST='0.6,1.0'`
   - `LP_P_LIST='0.8,1.0,1.2,1.5'`  
   - `CONE_K_LIST='0.5,1.0,2.0,3.0'`

## Open Questions / TODOs

- Tune 3D mode parameters (k and metric) to match Eclipse diamonds.
- Confirm whether Eclipse uses an implicit 3D L1 union behavior in crossings.
- Validate on additional datasets once TARGET1 parity is achieved.

---

## 2025-09-01 – MRI fusion geometry fix and backend backfill

Problem: MRI overlay appeared ~10 mm too low when per-slice MRI geometry (IPP/IOP) was missing. Client had a synthetic index-based Z fallback, causing mismatched slice selection.

Fix:
- Backend now backfills MRI `ImagePositionPatient` (0020,0032), `ImageOrientationPatient` (0020,0037), and `PixelSpacing` (0028,0030) from on-disk DICOM in `/api/series/:id/images` if missing, and persists via storage.
- Registration endpoint `/api/registrations/:studyId` guarantees a flat 16-element MRI→CT matrix and corrects direction if necessary.
- Client fusion enforces strict geometry: excludes MRI slices without IPP (no synthetic Z), and navigation prefers IPP Z when available.

Key edits:
- `server/routes.ts`: backfill geometry in `/api/series/:id/images`; verify/transpose matrix in `/api/registrations/:studyId` when ambiguous.
- `server/storage.ts`: added `updateImageGeometry` helper to persist IPP/IOP/pixel spacing/metadata.
- `client/src/lib/fusion-utils.ts`: require IPP for fusion positioning.
- `client/src/components/dicom/working-viewer.tsx`: slice navigation prefers IPP Z.

Impact:
- Eliminates synthetic Z-induced misalignment; MRI overlay aligns with CT when MRI IPP/IOP are present. Tested on `LIMBIC_57`.

Operational note:
- If some MR slices truly lack geometry in the source DICOM, they are excluded from fusion. Consider re-import/backfill or show a warning banner in the UI.
