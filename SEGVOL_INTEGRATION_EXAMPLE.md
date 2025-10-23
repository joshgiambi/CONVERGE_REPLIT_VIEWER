# SegVol Integration Example

This document shows how to use SegVol in your prediction workflow.

## Quick Start

### 1. Enable SegVol Mode

The prediction mode is configured in `working-viewer.tsx`. To use SegVol, change the `predictionMode` parameter:

```typescript
// In working-viewer.tsx, line ~2204

// BEFORE (geometric prediction):
let prediction = await predictNextSliceContour({
  ...
  predictionMode: historyManager.size() >= 2 ? 'trend-based' : 'adaptive',
  ...
});

// AFTER (SegVol AI prediction):
let prediction = await predictNextSliceContour({
  ...
  predictionMode: 'segvol',  // 👈 Use AI prediction
  ...
});
```

### 2. Hybrid Mode with Fallback

Recommended approach: Try SegVol first, fall back to geometric if unavailable:

```typescript
import { segvolClient } from '@/lib/segvol-client';

// Check if SegVol is available
const segvolHealth = await segvolClient.checkHealth();
const useSegVol = segvolHealth.segvol_available;

// Dynamic mode selection
let prediction = await predictNextSliceContour({
  currentContour: referenceSnapshot.contour,
  currentSlicePosition: referenceSnapshot.slicePosition,
  targetSlicePosition: slicePosition,
  predictionMode: useSegVol ? 'segvol' : 'trend-based',  // 👈 Hybrid
  confidenceThreshold: 0.2,
  historyManager,
  imageData,
  coordinateTransforms,
  enableImageRefinement: true,
  allContours: allContoursMap
});
```

### 3. User-Selectable Mode (UI Toggle)

Add a toggle in your toolbar to let users choose:

```typescript
// In contour-edit-toolbar.tsx or similar

import { useState } from 'react';
import { segvolClient } from '@/lib/segvol-client';

export function PredictionModeToggle() {
  const [mode, setMode] = useState<'geometric' | 'ai'>('geometric');
  const [segvolAvailable, setSegvolAvailable] = useState(false);

  // Check SegVol availability on mount
  useEffect(() => {
    segvolClient.checkHealth().then(health => {
      setSegvolAvailable(health.segvol_available);
    });
  }, []);

  return (
    <div className="flex gap-2">
      <button
        onClick={() => setMode('geometric')}
        className={mode === 'geometric' ? 'active' : ''}
      >
        ⚡ Fast (Geometric)
      </button>
      <button
        onClick={() => setMode('ai')}
        disabled={!segvolAvailable}
        className={mode === 'ai' ? 'active' : ''}
      >
        🤖 AI (SegVol) {!segvolAvailable && '(Unavailable)'}
      </button>
    </div>
  );
}
```

## Advanced Usage

### Batch Prediction

Predict multiple slices at once:

```typescript
import { segvolClient } from '@/lib/segvol-client';

// Prepare target slices
const targets = [51, 52, 53].map(slicePosition => ({
  slice_position: slicePosition,
  slice_data: getSlicePixelData(slicePosition)  // Your function
}));

// Batch predict
const results = await segvolClient.predictBatch(
  referenceContour2D,
  referenceSlicePixelData,
  referenceSlicePosition,
  [512, 512],  // image shape
  targets,
  [1.0, 1.0, 2.5]  // spacing [x, y, z]
);

// Process results
results.predictions.forEach(pred => {
  console.log(`Slice ${pred.slice_position}: ${pred.confidence} confidence`);
  // Use pred.predicted_contour
});
```

### Confidence-Based Strategy

Use geometric for high-confidence slices, SegVol for difficult cases:

```typescript
// Try geometric first
let prediction = await predictNextSliceContour({
  ...params,
  predictionMode: 'trend-based'
});

// If confidence is low, try SegVol
if (prediction.confidence < 0.5) {
  console.log('Low confidence, trying SegVol...');
  prediction = await predictNextSliceContour({
    ...params,
    predictionMode: 'segvol'
  });
}
```

### Error Handling

```typescript
try {
  const prediction = await predictNextSliceContour({
    ...params,
    predictionMode: 'segvol'
  });

  if (prediction.metadata?.fallbackApplied) {
    // SegVol failed, geometric fallback was used
    console.warn('SegVol unavailable, used geometric prediction');
    showUserNotification('Using fast prediction mode');
  }
} catch (error) {
  console.error('Prediction failed:', error);
  // Handle error
}
```

## Performance Tips

### 1. Caching SegVol Availability

```typescript
// Cache health check result
let segvolCached: boolean | null = null;
let cacheExpiry = 0;

async function isSegVolAvailable(): Promise<boolean> {
  const now = Date.now();
  if (segvolCached !== null && now < cacheExpiry) {
    return segvolCached;
  }

  const health = await segvolClient.checkHealth();
  segvolCached = health.segvol_available;
  cacheExpiry = now + 60000; // Cache for 1 minute

  return segvolCached;
}
```

### 2. Preload Image Data

```typescript
// Preload image data for faster prediction
const imageDataCache = new Map<number, ImageData>();

function preloadSliceData(slicePosition: number) {
  if (!imageDataCache.has(slicePosition)) {
    const data = extractImageDataForPrediction(slicePosition);
    imageDataCache.set(slicePosition, data);
  }
}

// Use cached data
const targetImageData = imageDataCache.get(targetSlicePosition);
```

### 3. Progressive Enhancement

```typescript
// Show geometric prediction immediately, upgrade with SegVol
async function predictWithProgressive(params: PredictionParams) {
  // 1. Show fast geometric prediction first
  const geometricPrediction = await predictNextSliceContour({
    ...params,
    predictionMode: 'trend-based'
  });

  displayPrediction(geometricPrediction);  // User sees result immediately

  // 2. Upgrade with SegVol if available
  if (await isSegVolAvailable()) {
    const segvolPrediction = await predictNextSliceContour({
      ...params,
      predictionMode: 'segvol'
    });

    if (segvolPrediction.confidence > geometricPrediction.confidence) {
      displayPrediction(segvolPrediction);  // Replace with better prediction
    }
  }
}
```

## Monitoring

### Check Service Status

```typescript
import { segvolClient } from '@/lib/segvol-client';

// Health check
const health = await segvolClient.checkHealth();
console.log('SegVol Status:', health);

// Get model info
const info = await segvolClient.getInfo();
console.log('SegVol Info:', info);
```

### Log Prediction Performance

```typescript
const startTime = performance.now();

const prediction = await predictNextSliceContour({
  ...params,
  predictionMode: 'segvol'
});

const duration = performance.now() - startTime;
console.log(`Prediction took ${duration.toFixed(0)}ms`);
console.log(`Method: ${prediction.metadata?.method}`);
console.log(`Confidence: ${(prediction.confidence * 100).toFixed(1)}%`);
```

## Testing

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest';
import { predictNextSliceContour } from '@/lib/contour-prediction';

describe('SegVol Integration', () => {
  it('should fall back to geometric if SegVol fails', async () => {
    const result = await predictNextSliceContour({
      currentContour: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
      currentSlicePosition: 50,
      targetSlicePosition: 51,
      predictionMode: 'segvol',
      // No imageData provided → should trigger fallback
    });

    expect(result.metadata?.fallbackApplied).toBe(true);
    expect(result.predictedContour.length).toBeGreaterThan(0);
  });
});
```

## Debugging

### Enable Verbose Logging

```typescript
// In browser console
localStorage.setItem('debug_segvol', 'true');

// In segvol-client.ts, add logging:
if (localStorage.getItem('debug_segvol')) {
  console.log('[SegVol] Request:', params);
  console.log('[SegVol] Response:', result);
}
```

### Inspect Network Requests

```javascript
// In browser DevTools
// 1. Open Network tab
// 2. Filter: /segvol/
// 3. Inspect request/response payloads
```

## Migration Guide

### From Geometric to Hybrid Mode

**Step 1**: Add SegVol as fallback option
```typescript
// Before
predictionMode: 'trend-based'

// After
predictionMode: isSegVolAvailable ? 'segvol' : 'trend-based'
```

**Step 2**: Test both modes
```typescript
const modes = ['trend-based', 'segvol'];
for (const mode of modes) {
  const result = await predict({ ...params, predictionMode: mode });
  console.log(`${mode}: ${result.confidence}`);
}
```

**Step 3**: Deploy with feature flag
```typescript
const ENABLE_SEGVOL = process.env.ENABLE_SEGVOL === 'true';
predictionMode: ENABLE_SEGVOL ? 'segvol' : 'trend-based'
```

## Best Practices

1. **Always provide image data for SegVol** - It requires DICOM pixel data
2. **Use coordinate transforms** - SegVol works in pixel space
3. **Set appropriate timeout** - Default 30s may need adjustment
4. **Monitor performance** - Log prediction times
5. **Handle failures gracefully** - Always have geometric fallback
6. **Cache availability checks** - Don't ping service on every prediction
7. **Batch when possible** - More efficient than individual predictions

## See Also

- [SEGVOL_SETUP.md](./SEGVOL_SETUP.md) - Complete setup guide
- [contour-prediction.ts](./client/src/lib/contour-prediction.ts) - Prediction algorithm
- [segvol-client.ts](./client/src/lib/segvol-client.ts) - API client
- [SegVol Paper](https://arxiv.org/abs/2311.13385) - Research paper
