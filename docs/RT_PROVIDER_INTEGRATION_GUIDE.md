# RT Provider Integration Guide for Agent 5

**Created**: 2025-10-02 by Agent 3  
**Purpose**: Guide for mounting legacy RT UI components into ViewerV2 using the provider pattern.

---

## Overview

The `RTProvider` manages all RT structures state, including:
- Structure data and selection
- Brush/pen tool state (size, mode, enabled)
- Preview contours for non-destructive operations
- Busy indicators for async operations
- Undo/redo history

Legacy toolbars should be adapted to call provider methods instead of managing local state.

---

## Using RTProvider in Components

### 1. Import and Hook
```typescript
import { useRT } from '@/rt-structures/RTProvider';

function MyToolbar() {
  const { 
    brush, pen, busy,
    setBrushMode, setBrushSize, setBrushEnabled,
    setPenMode, setPenEnabled,
    setPreviewContours, clearPreview,
    setStructures, saveHistory
  } = useRT();
  
  // ... use provider state and methods
}
```

### 2. Provider State Structure

```typescript
// Brush state
brush.size        // number (mm)
brush.mode        // 'add' | 'erase'
brush.enabled     // boolean

// Pen state
pen.mode          // 'add' | 'cut'
pen.enabled       // boolean

// Operations state
busy              // boolean - true during async operations
previewContours   // Array<{ slicePosition: number; points: number[] }>
```

### 3. Common Patterns

#### Brush Tool Buttons
```typescript
// Add mode
<button 
  onClick={() => { 
    setBrushMode('add'); 
    setBrushEnabled(true); 
    setPenEnabled(false); // Disable other tools
  }}
  style={{ 
    background: brush.enabled && brush.mode === 'add' ? '#3b82f6' : '#374151' 
  }}
>
  Brush Add
</button>

// Erase mode
<button 
  onClick={() => { 
    setBrushMode('erase'); 
    setBrushEnabled(true); 
    setPenEnabled(false);
  }}
  style={{ 
    background: brush.enabled && brush.mode === 'erase' ? '#ef4444' : '#374151' 
  }}
>
  Brush Erase
</button>

// Size control
<input
  type="number"
  value={brush.size}
  onChange={(e) => setBrushSize(Number(e.target.value))}
  min="1"
  max="50"
/>
```

#### Pen Tool Buttons
```typescript
// Add mode
<button 
  onClick={() => { 
    setPenMode('add'); 
    setPenEnabled(true); 
    setBrushEnabled(false);
  }}
  style={{ 
    background: pen.enabled && pen.mode === 'add' ? '#10b981' : '#374151' 
  }}
>
  Pen Add
</button>

// Cut mode
<button 
  onClick={() => { 
    setPenMode('cut'); 
    setPenEnabled(true); 
    setBrushEnabled(false);
  }}
  style={{ 
    background: pen.enabled && pen.mode === 'cut' ? '#f59e0b' : '#374151' 
  }}
>
  Pen Cut
</button>
```

#### Boolean Operations with Preview
```typescript
const handleBooleanPreview = async () => {
  if (!rtStructures || !sourceId || !targetId) return;
  setBusy(true);
  try {
    const service = createContourOperationsService();
    const previews = await service.previewBooleanOperation(
      rtStructures,
      sourceId,
      targetId,
      'union' // or 'subtract', 'intersect'
    );
    setPreviewContours(previews);
  } catch (err) {
    console.error('Preview failed', err);
  } finally {
    setBusy(false);
  }
};

const handleBooleanApply = async () => {
  if (!rtStructures || !sourceId || !targetId) return;
  setBusy(true);
  try {
    const service = createContourOperationsService();
    const result = await service.booleanOperationMultiSlice(
      rtStructures,
      sourceId,
      targetId,
      'union'
    );
    setStructures(result);
    saveHistory('boolean_union', sourceId);
    clearPreview();
  } catch (err) {
    console.error('Apply failed', err);
  } finally {
    setBusy(false);
  }
};

// UI
<button onClick={handleBooleanPreview} disabled={busy}>
  Preview
</button>
<button onClick={handleBooleanApply} disabled={busy}>
  Apply
</button>
{busy && <span>Processing...</span>}
```

---

## Reference Implementation

**Important**: `RTControlPanel.tsx` matches the legacy production UI (structure list only). For a complete example of provider wiring, see `RTControlPanelDemo.tsx`.

See `client/src/rt-structures/components/RTControlPanelDemo.tsx` for a complete working example that demonstrates:
- Structure list with visibility toggles
- Brush tool mode and size controls
- Pen tool mode controls
- Boolean operation preview/apply workflow
- Busy state indicators

**Note**: This demo panel is for reference only. Production UI (`RTControlPanel.tsx`) matches the legacy viewer exactly. When Agent 5 mounts legacy toolbars in ViewerV2, they should use this demo as a wiring guide while preserving the original toolbar appearance.

---

## Migration Checklist for Legacy Toolbars

When adapting existing toolbars to use RTProvider:

- [ ] Replace local `useState` for brush/pen mode with `useRT()` hooks
- [ ] Replace local brush size state with `brush.size` from provider
- [ ] Update button handlers to call `setBrushMode`, `setPenMode`, etc.
- [ ] Use `busy` flag from provider instead of local loading states
- [ ] Use `setPreviewContours` for preview operations instead of local state
- [ ] Call `setBrushEnabled(true)` / `setPenEnabled(false)` to coordinate tool exclusivity
- [ ] Ensure visual feedback (button highlighting) reflects provider state

---

## Testing Recommendations

1. **Tool Switching**: Verify only one tool (brush/pen) can be active at a time
2. **State Persistence**: Tool settings (brush size, mode) should persist across component remounts
3. **Preview Workflow**: Preview → Apply → Clear should work without state leaks
4. **Busy Indicators**: Long operations should show busy state; UI should disable buttons during processing
5. **Undo/Redo**: Operations should integrate with undo/redo history via `saveHistory`

---

## Integration Steps for Agent 5

1. **Review RTControlPanel**: Understand the reference implementation
2. **Adapt Legacy Toolbars**: Update existing toolbar components to use provider hooks
3. **Mount in ViewerV2**: Add adapted toolbars to the appropriate ViewerV2 slots
4. **Visual Regression**: Compare `/viewer` and `/viewer-v2` side-by-side
5. **Functional Testing**: Test all RT operations (boolean, margins, brush, pen) in the new layout

---

**Questions?** Refer to:
- `client/src/rt-structures/RTProvider.tsx` - Provider implementation
- `client/src/rt-structures/components/RTControlPanel.tsx` - Production UI (legacy-matching)
- `client/src/rt-structures/components/RTControlPanelDemo.tsx` - Reference wiring example
- `client/src/rt-structures/services/ContourOperationsService.ts` - Service layer
- `docs/AGENT3_COMPREHENSIVE_REVIEW.md` - Feature completion status

