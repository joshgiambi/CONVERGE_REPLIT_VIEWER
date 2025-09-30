# Fusion Overlay "Frozen CT" Fix - 2025-09-30

## Problem Summary

The fusion overlay was showing a "frozen" CT image - all PET slices mapped to the same CT slice (SOP UID `1.2.246....494566`), causing the overlay to remain static while scrolling through the stack.

## Root Cause

**Diagnostic from User:**
- Manifest showed 194 out of 207 PET instances mapping to the same `primarySopInstanceUID`
- Only the last handful of slices mapped to different CT slices
- Database had correct unique CT SOPs with proper z-coordinates spanning 594.1 to 182.1

**The Bug:**
In `server/fusion/manifest-service.ts`, the `parsePosition` function failed to parse image positions stored in escaped backslash format:
```
" -249.51171875\\-448.51171875\\594.1"
```

The original code:
```typescript
const parts = value.split('\\').map((part) => Number(part.trim()));
```

This looked for a SINGLE backslash `\`, but the actual stored string had DOUBLE backslashes `\\` (escaped). JavaScript's `split('\\')` was searching for the literal characters `\` `\`, not splitting at the backslashes at all, so it returned the entire string as one element.

**Result:** `parsePosition` returned `null` for every primary image position, causing the "nearest match" algorithm to skip entirely and fall back to `primaryImages[fallbackIndex]` repeatedly, stamping the same SOP across all PET slices.

## Fixes Applied

### 1. Fix `parsePosition` in `manifest-service.ts` (Line 562)

```typescript
const parsePosition = (value: unknown): [number, number, number] | null => {
  if (!value) return null;
  if (Array.isArray(value) && value.length >= 3) {
    const coords = value.map((component) => Number(component)) as [number, number, number];
    if (coords.every((component) => Number.isFinite(component))) return coords;
  }
  if (typeof value === 'string') {
    // Handle both single backslash and double-escaped backslash formats
    // Examples: "-249.5\-448.5\594.1" or "-249.5\\-448.5\\594.1"
    let cleaned = value.trim();
    // Replace double backslashes with single for splitting
    cleaned = cleaned.replace(/\\\\/g, '\\');
    const parts = cleaned.split('\\').map((part) => Number(part.trim()));
    if (parts.length >= 3 && parts.every((component) => Number.isFinite(component))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
};
```

**What changed:**
- Added `cleaned.replace(/\\\\/g, '\\')` to normalize double-escaped backslashes
- Now handles both formats: `"-249.5\-448.5\594.1"` and `"-249.5\\-448.5\\594.1"`

### 2. Fix Image Position Storage in `routes.ts` (Line 2401)

**Before:**
```typescript
imagePosition: (ipp && ipp.length >= 3) ? `${ipp[0]}\\${ipp[1]}\\${ipp[2]}` : img.imagePosition || null,
```

**After:**
```typescript
imagePosition: (ipp && ipp.length >= 3) ? [ipp[0], ipp[1], ipp[2]] : img.imagePosition || null,
```

**Why:** The `imagePosition` column is defined as `jsonb` in the schema, so it should store a JSON array `[x, y, z]`, not a backslash-delimited string. This prevents the issue from recurring on future ingests.

## Verification

After forcing manifest regeneration:
```bash
curl "http://localhost:3000/api/fusion/manifest?primarySeriesId=2578&force=true&preload=true"
```

**Results:**
- ✅ 207 unique primary SOPs (one per PET slice)
- ✅ Each PET instance correctly maps to the nearest CT slice by z-coordinate
- ✅ Manifest first 5 SOPs all different: `...333084`, `...389674`, `...919684`, `...328541`, `...141525`

**Before the fix:**
- ❌ 194/207 instances mapped to the same SOP
- ❌ Only last ~13 slices had unique mappings

## Expected Behavior After Fix

1. **Scrolling works**: CT image updates as you scroll through PET slices
2. **Correct alignment**: Each PET slice overlays on the anatomically correct CT slice
3. **No "frozen" overlay**: The fusion overlay moves with the stack

## Related Files Changed

- `server/fusion/manifest-service.ts` - Fixed `parsePosition` (lines 562-580)
- `server/routes.ts` - Fixed backfill geometry storage (line 2401)

## Prevention

Future ingestion will store `imagePosition` as arrays instead of strings, eliminating the need for string parsing entirely. The parsePosition function now handles legacy data robustly.


