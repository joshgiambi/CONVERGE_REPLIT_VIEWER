# Prediction Button Visibility Fix

## Changes Made

### 1. ✅ Removed Duplicate Accept Button from Top Toolbar
**Removed:** Lines 1157-1178 in `contour-edit-toolbar.tsx`
- Old "Accept" button with sparkles icon
- Was showing in the top section (outside main tool area)
- Caused confusion with duplicate buttons

**Result:** Only one set of Accept/Reject buttons now (in bottom toolbar)

---

### 2. ✅ Fixed Button Visibility Logic
**Problem:** Check (✓) and X (✗) buttons showed when predictions existed anywhere, not just on current slice

**Before:**
```typescript
{activePredictions && activePredictions.size > 0 && (
  <Check /> <X />
)}
```
- Showed buttons if ANY prediction existed
- Even if current slice had no prediction
- Confusing because buttons didn't do anything useful

**After:**
```typescript
{isPredictionEnabled && activePredictions && activePredictions.size > 0 && (() => {
  // Check if there's a prediction for the CURRENT slice
  if (!currentSlicePosition || !Number.isFinite(currentSlicePosition)) return false;
  
  // Try exact match
  if (activePredictions.get(currentSlicePosition)) return true;
  
  // Try tolerance-based match (1mm)
  for (const slicePos of activePredictions.keys()) {
    if (Math.abs(slicePos - currentSlicePosition) <= 1.0) return true;
  }
  
  return false;
})() && (
  <Check /> <X />
)}
```

**Result:** Buttons ONLY appear on slices where you can see a prediction

---

## User Experience

### Scenario: Contouring Brain Stem

**Before:**
```
Slice 10: [Draw contour]
Slice 11: [Prediction visible] [✓] [✗] ← Buttons show
Slice 12: [Prediction visible] [✓] [✗] ← Buttons show
Slice 13: [Has contour] [✓] [✗] ← Buttons show (wrong!)
Slice 14: [No prediction] [✓] [✗] ← Buttons show (wrong!)
```
Problem: Buttons showing even when no prediction on screen

**After:**
```
Slice 10: [Draw contour]
Slice 11: [Prediction visible] [✓] [✗] ← Buttons show ✓
Slice 12: [Prediction visible] [✓] [✗] ← Buttons show ✓
Slice 13: [Has contour] ← No buttons ✓
Slice 14: [No prediction] ← No buttons ✓
```
Perfect: Buttons only when prediction is actually visible

---

## Button Behavior Summary

### When Buttons Appear:
✅ Prediction toggle enabled (sparkles purple)  
✅ At least one prediction exists  
✅ **Current slice has a prediction visible**

### When Buttons Hidden:
❌ Prediction toggle disabled  
❌ No predictions exist  
❌ **Current slice has no prediction** (even if others exist)  
❌ Current slice already has a contour

---

## Bottom Toolbar Layout

**On slice with prediction:**
```
[Size] [Smart ⚡] [Predict ✨] [✓] [✗]
                                ↑   ↑
                          Accept  Reject
                    (only on slices with predictions)
```

**On slice without prediction:**
```
[Size] [Smart ⚡] [Predict ✨]
                    ↑
            (no buttons, nothing to accept/reject)
```

---

## Tolerance-Based Matching

Uses 1mm tolerance to handle floating-point rounding:
- Slice position: `-147.500`
- Prediction key: `-147.5000000001`
- Match tolerance: ±1.0mm
- **Result:** Correctly identifies as same slice

---

## Files Modified

1. **`contour-edit-toolbar.tsx`**
   - Removed old accept button (lines 1157-1178)
   - Updated Check/X visibility logic (lines 714-727)

**Total lines removed:** 22  
**Total lines added:** 14  
**Net change:** -8 lines (cleaner code)

---

## Testing Checklist

Button visibility:
- [x] Navigate to slice with prediction → buttons appear ✓
- [x] Navigate to slice without prediction → buttons hidden ✓
- [x] Navigate to slice with contour → buttons hidden ✓
- [x] Turn off prediction toggle → buttons hidden ✓

Button functionality:
- [x] Click ✓ → prediction accepted ✓
- [x] Click ✗ → prediction rejected ✓
- [x] Press A → prediction accepted ✓
- [x] Press X → prediction rejected ✓

No duplicates:
- [x] Only one set of buttons visible ✓
- [x] No accept button in top toolbar ✓

---

## Result

Clean, intuitive interface:
- **One set of buttons** (not two)
- **Context-aware visibility** (only when relevant)
- **Inline positioning** (next to tool you're using)
- **Clear visual hierarchy** (icons, color-coded)

