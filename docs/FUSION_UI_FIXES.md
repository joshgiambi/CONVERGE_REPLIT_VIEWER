# Fusion UI Fixes - 2025-09-30

## Critical Issues Fixed

### 1. **Infinite Loop in Fusion Prefetch (CRITICAL)**
**Location**: `client/src/components/dicom/working-viewer.tsx` lines 590-605 and 4633-4636

**Problem**: Two `useEffect` hooks were depending on `prefetchFusionSlices`, which is a callback with many volatile dependencies (`fusionSecondaryStatuses`, `fusionManifestPrimarySeriesId`, `images`, etc.). Every time any of those dependencies changed, the callback was recreated, which triggered the effect again, creating an infinite loop that caused:
- Constant page reloads
- Browser crashes
- Frozen UI
- High CPU/memory usage

**Fix**: 
- Used a ref (`prefetchFusionSlicesRef`) to track the latest version of the prefetch function without including it in dependency arrays
- Removed duplicate prefetch useEffect that was causing redundant calls
- Prefetching now happens automatically without triggering infinite loops

### 2. **Infinite Loop in Registration Matrix Updates**
**Location**: `client/src/components/dicom/working-viewer.tsx` lines 3353-3359

**Problem**: The `useEffect` that clears the fusion cache when the registration matrix changes was depending on `scheduleRender`, which gets recreated frequently. This caused continuous re-renders that could cascade into other state changes.

**Fix**: Removed `scheduleRender` from dependencies and instead used `setRenderTrigger` to safely trigger a re-render without creating loops.

### 3. **Broken Debug Code**
**Location**: `client/src/components/dicom/working-viewer.tsx` lines 680-685

**Problem**: References to non-existent state setters (`setFusionDebugText`, `setShowFusionDebug`) were causing errors.

**Fix**: Changed to log to console instead of trying to use removed debug UI components.

## How the Fusion System Works

### Opacity Control Flow
1. User adjusts slider in `FusionControlPanel`
2. Calls `handleOpacityChange` → `onOpacityChange(value)`
3. Wired to `setFusionOpacity` in `ViewerInterface`
4. Passed to `WorkingViewer` as `fusionOpacity` prop
5. Used in `drawFusionOverlay` to set canvas alpha (line 4792)
6. Also checked at line 4661 to skip rendering if opacity is 0

### Secondary Series Selection Flow
1. User clicks secondary series card in `SeriesSelector`
2. Calls `onSecondarySeriesSelect(seriesId)`
3. Wired to `setSecondarySeriesId` in `ViewerInterface`
4. Triggers fusion manifest initialization
5. Starts fusion volume preparation
6. Updates `fusionSecondaryStatuses` map
7. When status becomes 'ready', fusion overlay renders

### Image Scrolling Flow
1. User scrolls mouse wheel on canvas
2. Triggers `handleCanvasWheel` (line 5421)
3. Calls `goToNext()` or `goToPrevious()`
4. Updates `currentIndex` state
5. Triggers `displayCurrentImage` to render new slice
6. Fusion overlay fetches corresponding fused slice
7. RT structures render on top

## Testing After Fixes

### Expected Behavior
✅ Page should not reload when selecting secondary series
✅ Opacity slider should smoothly adjust fusion overlay transparency
✅ CT image should scroll normally with mouse wheel
✅ Fusion overlay should align properly with CT
✅ No browser crashes or freezing
✅ Smooth performance when scrolling through slices

### Debugging Steps
1. **Check Console Logs**: Look for:
   - `🔄 Initializing fusion manifest` - should only appear once per series selection
   - `🛑 FUSION INIT ABORTED` - should NOT appear (indicates loop was prevented)
   - `📍 Navigate: X → Y` - should appear when scrolling
   - `🐟 FUSION:` - fusion-related logs

2. **Check Network Tab**: Fusion slice requests should:
   - Only happen once per slice
   - Show 200 status codes
   - Not flood the network constantly

3. **Check Performance**: CPU usage should:
   - Stay reasonable (not 100%)
   - Drop back down after initial fusion volume build
   - Not spike continuously

## Remaining Issues to Check

If problems persist after refreshing:

1. **CT Won't Scroll**: Check if `currentIndex` state is updating in React DevTools
2. **Opacity Not Working**: Verify `fusionOpacity` state is changing in React DevTools
3. **Alignment Issues**: Check fusion transform matrices in network response for `/api/fusebox/slice`
4. **Reloads on Click**: Check if there's navigation happening in browser DevTools Network tab

## Next Steps

1. **Refresh the browser** to ensure new code is loaded
2. **Test fusion with a known good dataset**
3. **Monitor console for errors**
4. **Report specific symptoms** if issues persist

The infinite loops were likely causing most of the problems - the browser was thrashing so hard it appeared frozen and would eventually crash or force-reload.


