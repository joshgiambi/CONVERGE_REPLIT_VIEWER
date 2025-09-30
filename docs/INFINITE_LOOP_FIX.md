# Infinite Loop & RT Structure Fix

## Changes Made

### 1. Hard Stop for Fusion Init Loop
**Location**: [viewer-interface.tsx:1617-1672](../client/src/components/dicom/viewer-interface.tsx#L1617-L1672)

Added a hard limit of 3 fusion initialization attempts to prevent infinite loops:

```typescript
const initCountRef = useRef<number>(0);
const MAX_INIT_ATTEMPTS = 3; // Hard limit to prevent infinite loops

// HARD STOP: If we've tried too many times, abort to prevent crashes
if (initCountRef.current >= MAX_INIT_ATTEMPTS) {
  console.error('🛑 FUSION INIT ABORTED: Maximum attempts reached. Preventing infinite loop.');
  return;
}
```

**Console Logs to Watch:**
- `🔄 Initializing fusion manifest: { attempt: X, ... }` - Shows initialization attempts
- `⏸️ Fusion init skipped: within cooldown period` - Cooldown working
- `🛑 FUSION INIT ABORTED: Maximum attempts reached` - **Hard stop triggered (critical!)**
- `❌ Fusion initialization failed: ...` - Error occurred

### 2. RT Series Loading Debug
**Location**: [series-selector.tsx:325-334](../client/src/components/dicom/series-selector.tsx#L325-L334)

Added detailed logging when RT series are loaded:

```typescript
console.log(`✅ Loaded ${deduped.length} RT series for studies: ...`);
console.log('RT Series Details:', deduped.map(rt => ({
  id: rt.id,
  desc: rt.seriesDescription,
  referencedSeriesId: rt.referencedSeriesId,
  referencedSeriesUID: rt.referencedSeriesUID,
})));
```

## Diagnostic Steps

### Step 1: Check for Fusion Loop
Open browser console and look for:

1. **Normal behavior (good):**
   ```
   🔄 Initializing fusion manifest: { attempt: 1, primarySeriesId: 123, ... }
   ```

2. **Loop detected (bad):**
   ```
   🔄 Initializing fusion manifest: { attempt: 1, ... }
   🔄 Initializing fusion manifest: { attempt: 2, ... }
   🔄 Initializing fusion manifest: { attempt: 3, ... }
   🛑 FUSION INIT ABORTED: Maximum attempts reached. Preventing infinite loop.
   ```

3. **Crash before hard stop (very bad):**
   ```
   🔄 Initializing fusion manifest: { attempt: 1, ... }
   🔄 Initializing fusion manifest: { attempt: 2, ... }
   [Page crashes and reloads]
   ```

   This means the crash is happening INSIDE `initializeFusionForSeries()`, not from the loop itself.

### Step 2: Check RT Structure Selection
Look for these logs:

1. **RT series loaded:**
   ```
   ✅ Loaded 2 RT series for studies: 123
   RT Series Details: [
     { id: 456, desc: "RTstruct_Planning", referencedSeriesId: 123, referencedSeriesUID: "1.2.3..." },
     { id: 789, desc: "RTstruct_AcqIsocenter", referencedSeriesId: null, referencedSeriesUID: null }
   ]
   ```

2. **RT selection process:**
   ```
   🔄 RT Selection Effect triggered: { rtSeriesCount: 2, selectedSeriesId: 123, ... }
     RT 456 (RTstruct_Planning): referencedSeriesId=123, matches=true
     RT 789 (RTstruct_AcqIsocenter): referencedSeriesId=null, matches=false
   🎯 Auto-selecting RT structure that references primary series 123: RTstruct_Planning (ID: 456)
   ```

3. **Wrong RT selected (problem!):**
   ```
   🔄 RT Selection Effect triggered: { rtSeriesCount: 2, selectedSeriesId: 123, ... }
     RT 456 (RTstruct_Planning): referencedSeriesId=null, matches=false
     RT 789 (RTstruct_AcqIsocenter): referencedSeriesId=null, matches=false
   ⚠️ No RT structures reference primary series 123
   ⚠️ Falling back to most recent RT: RTstruct_AcqIsocenter (ID: 789)
   ```

### Step 3: Identify the Crash Source

If the page is crashing and reloading, the error is likely:

1. **Memory leak in fusion processing** - Check if it's trying to load very large images
2. **Unhandled promise rejection** - Check for `Uncaught (in promise)` errors
3. **Stack overflow** - Check if something is recursively calling itself
4. **Network request failure** - Check Network tab for failed requests

## What to Report Back

Please copy/paste from your browser console:

### 1. Fusion Init Logs
```
[Copy all logs starting with 🔄, ⏸️, or 🛑]
```

### 2. RT Series Details
```
[Copy the "RT Series Details" log showing all RT structures]
```

### 3. RT Selection Process
```
[Copy all logs starting with "RT X" showing matches=true/false]
```

### 4. Any Error Messages
```
[Copy any red error messages, especially "Uncaught" or "Failed to fetch"]
```

### 5. Network Tab Issues
Check the Network tab in DevTools:
- Are there any failed requests (red)?
- Are there requests that never complete (pending forever)?
- What is the last successful request before the crash?

## Immediate Workaround

If the page keeps crashing, you can temporarily disable auto-fusion:

1. Open the browser console
2. Before loading the viewer, run:
   ```javascript
   localStorage.setItem('disableAutoFusion', 'true');
   ```
3. Reload the page
4. Fusion won't auto-initialize, preventing the loop

To re-enable:
```javascript
localStorage.removeItem('disableAutoFusion');
```

## Expected Behavior

**Correct RT Selection:**
1. RT structure with `referencedSeriesId` matching the primary CT should be selected
2. Console should show `matches=true` for the correct RT
3. Console should show `🎯 Auto-selecting RT structure that references primary series`

**If Wrong RT Selected:**
1. Check `RT Series Details` log - does the correct RT have `referencedSeriesId` set?
2. If NULL, the database needs updating or DICOM needs re-import
3. If set but not matching, the selected primary CT might be wrong

**If Fusion Loop:**
1. Should stop after 3 attempts with 🛑 message
2. If crashing before 3 attempts, the crash is inside fusion init
3. Need to check what fusion is trying to load (check the candidateIds in the log)

## Next Steps Based on Output

### If you see: "🛑 FUSION INIT ABORTED"
- Good news: The hard stop is working
- Bad news: Something is causing repeated re-renders
- Check: What changed between attempts in the logs?

### If you see: Crash before attempt 3
- The crash is in `initializeFusionForSeries()`
- Check: Network tab for failed/hanging requests
- Check: Console for uncaught errors

### If you see: Wrong RT selected with "matches=false" for all
- The RT structures don't have `referencedSeriesId` set
- Check: Database needs updating
- Run: Fusion debug dialog to see relationships

## Files Changed

1. [viewer-interface.tsx:1620-1621](../client/src/components/dicom/viewer-interface.tsx#L1620-L1621) - Added initCountRef and MAX_INIT_ATTEMPTS
2. [viewer-interface.tsx:1639-1643](../client/src/components/dicom/viewer-interface.tsx#L1639-L1643) - Hard stop check
3. [viewer-interface.tsx:1655-1670](../client/src/components/dicom/viewer-interface.tsx#L1655-L1670) - Enhanced logging and try/catch
4. [series-selector.tsx:327-333](../client/src/components/dicom/series-selector.tsx#L327-L333) - RT series loading debug logs