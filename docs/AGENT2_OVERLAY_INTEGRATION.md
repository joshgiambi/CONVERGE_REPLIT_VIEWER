# Agent 2 Overlay Integration Guide

## ✅ Overlay Canvas is Ready!

The dedicated overlay canvas has been implemented in `PrimaryViewport` and is ready for Agent 2 (Fusion) to use.

---

## What's Available

### 1. Dedicated Overlay Canvas
- **Separate canvas** (`overlayCanvasRef`) specifically for fusion/RT overlays
- **No interference** with base CT rendering
- **Properly sized** with device pixel ratio support
- **Positioned correctly** (absolute, full viewport size)
- **Non-interactive** (`pointer-events-none`) - doesn't block viewport interactions

### 2. ViewportContext Access

Agent 2 can access the overlay canvas via the `useViewport()` hook:

```typescript
import { useViewport } from '@/components/viewer/PrimaryViewport';

export function FusionOverlayLayer({ opacity }: Props) {
  const viewport = useViewport();
  
  // Access overlay canvas
  const overlayCanvas = viewport.overlayCanvasRef.current;
  const overlayCtx = overlayCanvas?.getContext('2d');
  
  // Also available:
  const { 
    canvasRef,           // Base CT canvas (read-only, don't draw here!)
    currentImage,        // Current DICOM image
    currentIndex,        // Current slice index
    images,              // All images in series
    zoom,                // Current zoom level
    panX,                // Pan X offset
    panY,                // Pan Y offset
    windowLevel,         // Current window/level
    imageMetadata        // Image metadata (spacing, orientation, etc.)
  } = viewport;
  
  // Draw fusion overlay to overlayCanvas...
}
```

---

## Integration Steps for Agent 2

### Step 1: Import the Hook
```typescript
import { useViewport } from '@/components/viewer/PrimaryViewport';
```

### Step 2: Access Viewport Context in Your Component
```typescript
export function FusionOverlayLayer({ opacity }: FusionOverlayLayerProps) {
  const viewport = useViewport();
  
  useEffect(() => {
    const overlayCanvas = viewport.overlayCanvasRef.current;
    if (!overlayCanvas) return;
    
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    
    // Clear previous overlay
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    // Draw your fusion overlay here
    // The canvas is already sized correctly (with device pixel ratio)
    // It's positioned to exactly match the base CT canvas
    
  }, [viewport, opacity]);
  
  return null; // No DOM - renders to canvas
}
```

### Step 3: Add Your Component as Child of PrimaryViewport
```typescript
<PrimaryViewport seriesId={123}>
  <FusionOverlayLayer opacity={0.5} />
</PrimaryViewport>
```

---

## Important Implementation Details

### Canvas Sizing
- Both base canvas and overlay canvas are sized together by the same `ResizeObserver`
- Device pixel ratio is automatically handled
- Canvas backing store matches display size perfectly
- You don't need to manage sizing - it's done for you

### Coordinate System
- Overlay canvas matches base canvas dimensions exactly
- Same zoom/pan transformations apply
- Draw at the same coordinates as the base CT image
- Example: If CT image is centered at (512, 512) on base canvas, fusion overlay at (512, 512) will align perfectly

### Rendering Order
1. **Base CT canvas** - rendered first (z-index: auto)
2. **Overlay canvas** - rendered on top (z-index: auto, but comes after in DOM)
3. **UI elements** - info overlays, controls (z-index: auto, positioned absolutely)

### Performance Tips
1. **Clear before drawing**: Always `ctx.clearRect()` before drawing new overlay
2. **Use globalAlpha**: Set opacity with `ctx.globalAlpha = opacity` instead of manipulating pixel data
3. **Avoid full redraws**: Only redraw when fusion data or viewport state changes
4. **Cache transformed data**: Transform fusion slices once, cache the ImageData

---

## Example: Full Fusion Overlay Component

```typescript
import { useEffect, useRef } from 'react';
import { useViewport } from '@/components/viewer/PrimaryViewport';
import { useFusion } from '@/fusion/fusion-context';

interface FusionOverlayLayerProps {
  opacity: number;
}

export function FusionOverlayLayer({ opacity }: FusionOverlayLayerProps) {
  const viewport = useViewport();
  const fusion = useFusion();
  const requestTokenRef = useRef(0);

  useEffect(() => {
    const overlayCanvas = viewport.overlayCanvasRef.current;
    if (!overlayCanvas) return;
    
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    // Clear overlay if no fusion or opacity is zero
    if (!fusion.selectedSecondaryId || opacity <= 0) {
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      return;
    }

    const currentImage = viewport.currentImage;
    if (!currentImage) return;

    const token = ++requestTokenRef.current;

    // Fetch fusion overlay for current slice
    fusion.getOverlayForImage({
      sopInstanceUID: currentImage.sopInstanceUID,
      sliceIndex: viewport.currentIndex,
      instanceNumber: currentImage.instanceNumber,
      position: currentImage.imagePositionPatient,
    })
    .then((overlay) => {
      // Abort if request is stale
      if (requestTokenRef.current !== token) return;
      if (!overlay || !overlay.hasSignal) return;

      // Clear canvas
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

      // Draw overlay with opacity
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
      ctx.drawImage(overlay.canvas, 0, 0, overlayCanvas.width, overlayCanvas.height);
      ctx.restore();
    })
    .catch((err) => {
      if (requestTokenRef.current !== token) return;
      console.warn('FusionOverlayLayer error:', err);
    });

  }, [viewport, fusion, opacity]);

  return null;
}
```

---

## Current Agent 2 FusionOverlayLayer Status

**Existing file**: `client/src/fusion/components/FusionOverlayLayer.tsx`

**Current implementation**: Needs update! Currently tries to:
- Use `useFusion()` hook (good)
- Access viewport via custom hook (needs update)
- Draw directly to base canvas (❌ WRONG - should use overlay canvas)

**Required changes**:
1. Import `useViewport` from `PrimaryViewport`
2. Access `viewport.overlayCanvasRef` instead of base canvas
3. Use overlay canvas for all drawing operations

---

## Testing Checklist

After integrating the overlay:

- [ ] Overlay renders on top of CT image
- [ ] Overlay aligns perfectly with CT anatomy
- [ ] Opacity control works (0-100%)
- [ ] Overlay updates when changing slices
- [ ] Overlay clears when fusion is disabled
- [ ] Pan/zoom interactions still work (overlay doesn't block)
- [ ] Window/level changes don't affect overlay rendering
- [ ] No flickering or performance issues
- [ ] High-DPI displays render correctly
- [ ] Canvas resizing works smoothly

---

## Troubleshooting

### Overlay not visible?
- Check `opacity` is > 0
- Verify overlay canvas exists: `viewport.overlayCanvasRef.current !== null`
- Check canvas is sized: `overlayCanvas.width > 0 && overlayCanvas.height > 0`
- Verify you're drawing after the canvas is mounted

### Overlay misaligned with CT?
- Make sure you're drawing to overlay canvas, not base canvas
- Check coordinate system - use same transforms as base rendering
- Verify overlay canvas size matches base canvas size

### Overlay blocks interactions?
- Check canvas has `pointer-events-none` in the DOM (it should!)
- This is already set in PrimaryViewport, you shouldn't need to change it

### Performance issues?
- Avoid redrawing on every frame
- Use `requestTokenRef` pattern to cancel stale requests
- Cache transformed fusion data
- Only clear and redraw when data actually changes

---

## Summary

✅ **Overlay canvas is fully implemented and ready to use**

**Agent 2 needs to**:
1. Update `FusionOverlayLayer.tsx` to use `useViewport()` hook
2. Draw to `viewport.overlayCanvasRef` instead of base canvas
3. Test with real PET/CT fusion data

**No changes needed in PrimaryViewport** - it's ready as-is!

