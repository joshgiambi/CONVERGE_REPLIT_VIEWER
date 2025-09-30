# Codebase Improvement Recommendations

## Executive Summary

This document provides a comprehensive analysis of improvement opportunities for the CONVERGE Medical Imaging Viewer application. The analysis covers architecture, performance, code quality, and developer experience.

**Key Metrics:**
- Frontend: 167 TypeScript/TSX files, 2.4MB source code
- Backend: 596KB source code
- Main bundle size: **1,656 KB** (492 KB gzipped) ⚠️
- Largest component: `working-viewer.tsx` (**6,273 lines**) ⚠️
- Second largest: `viewer-interface.tsx` (**2,681 lines**) ⚠️
- Console statements: 855+ across frontend ⚠️
- React hooks in viewer-interface: 82+ ⚠️

---

## 🚨 Critical Issues (High Impact)

### 1. Bundle Size Optimization
**Problem:** Main bundle is 1,656 KB (492 KB gzipped), exceeding recommended limits.

**Impact:**
- Slow initial page load (especially on 3G/4G)
- Poor mobile performance
- Increased bandwidth costs

**Solutions:**

#### A. Implement Code Splitting
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', /* all radix */],
          'vendor-cornerstone': ['cornerstone-core', 'cornerstone-tools', '@cornerstonejs/core'],
          'vendor-dicom': ['dicom-parser', 'dcmjs'],

          // Feature chunks - lazy load these
          'feature-contours': ['./client/src/lib/contour-*.ts', './client/src/margins/*'],
          'feature-fusion': ['./client/src/lib/fusion-utils.ts'],
          'feature-boolean': ['./client/src/boolean/*'],
        }
      }
    }
  }
});
```

#### B. Lazy Load Heavy Features
```typescript
// viewer-interface.tsx - Convert to lazy loading
const BooleanOperationsToolbar = lazy(() => import('./boolean-operations-toolbar-new'));
const FusionControlPanel = lazy(() => import('./fusion-control-panel'));
const MarginToolbar = lazy(() => import('./margin-toolbar'));

// Only render when needed
{isContourEditMode && (
  <Suspense fallback={<LoadingSpinner />}>
    <BooleanOperationsToolbar {...props} />
  </Suspense>
)}
```

#### C. Optimize Web Worker Bundle
Current: `computeWorker-BlaWzImP.js` is **1,200 KB**

```typescript
// Split worker into smaller, feature-specific workers
margin-worker.ts       // Only margin operations
boolean-worker.ts      // Only boolean operations
dicom-parser.worker.ts // Keep separate (already done)
```

**Expected Impact:**
- Initial bundle: 1,656 KB → ~600-800 KB
- Time to interactive: Improve by 40-60%

---

### 2. Massive Component Refactoring

**Problem:** `working-viewer.tsx` is **6,273 lines** - unmaintainable monolith.

**Impact:**
- Impossible to understand/modify safely
- High bug risk
- Poor code reuse
- Slow development velocity

**Solution:** Extract into focused components

```
working-viewer/
├── index.tsx                    (200 lines - orchestration only)
├── hooks/
│   ├── useImageLoading.ts      (image cache, DICOM parsing)
│   ├── useContourRendering.ts  (RT structure display)
│   ├── useFusionOverlay.ts     (secondary image fusion)
│   ├── useViewportTools.ts     (pan, zoom, crosshairs)
│   └── useSliceNavigation.ts   (slice position, scrolling)
├── components/
│   ├── ImageCanvas.tsx         (500 lines - canvas rendering)
│   ├── ContourOverlay.tsx      (400 lines - RT structure drawing)
│   ├── FusionOverlay.tsx       (300 lines - secondary image blend)
│   ├── ToolAnnotations.tsx     (200 lines - measurements, labels)
│   └── SliceNavigator.tsx      (150 lines - slice controls)
└── utils/
    ├── canvasHelpers.ts
    ├── coordinateTransform.ts
    └── imageProcessing.ts
```

**Benefits:**
- Each component <500 lines
- Clear separation of concerns
- Easier testing
- Reusable hooks across components

---

### 3. Duplicate Code Consolidation

**Problem:** 19 different margin/contour operation files with overlapping functionality.

**Current Files:**
```
anisotropic-margin-operations.ts
enhanced-margin-operations.ts
fast-3d-margin-operations.ts
morphological-margin-operations.ts
proper-morphological-margins.ts
true-3d-margin-operations.ts
volumetric-margin-operations.ts
volumetric-margin-operations-optimized.ts  ← Why two?
contour-margin-operations.ts
simple-margin-preview.ts
```

**Solution:** Create unified margin system

```typescript
// lib/margins/index.ts - Single entry point
export class MarginEngine {
  constructor(
    private strategy: '2d' | '3d-radial' | '3d-morphological' | '3d-anisotropic'
  ) {}

  async expand(contours: Contour[], marginMm: number): Promise<Contour[]> {
    switch (this.strategy) {
      case '2d': return this.expand2D(contours, marginMm);
      case '3d-radial': return this.expand3DRadial(contours, marginMm);
      case '3d-morphological': return this.expand3DMorphological(contours, marginMm);
      case '3d-anisotropic': return this.expand3DAnisotropic(contours, marginMm);
    }
  }

  private async expand2D() { /* fast-3d-margin-operations */ }
  private async expand3DRadial() { /* simple-3d-radial-expansion */ }
  private async expand3DMorphological() { /* morphological-margin-operations */ }
  private async expand3DAnisotropic() { /* anisotropic-margin-operations */ }
}

// Usage
const engine = new MarginEngine(userPreferredStrategy);
const result = await engine.expand(contours, 5.0);
```

**Expected Impact:**
- 19 files → 4-5 well-organized files
- ~50% code reduction through consolidation
- Clear API for consumers
- Easier to add new strategies

---

## ⚡ Performance Improvements

### 4. React Rendering Optimization

**Problem:** `viewer-interface.tsx` has 82 hooks and frequent re-renders.

**Issues:**
- Too many `useState` calls (30+)
- Missing `useMemo` for expensive computations
- Props drilling causing unnecessary re-renders

**Solutions:**

#### A. State Management Migration
```typescript
// Replace scattered useState with Zustand or Context + Reducer
import create from 'zustand';

interface ViewerStore {
  // Grouped state
  image: {
    selectedSeries: DICOMSeries | null;
    windowLevel: WindowLevel;
    currentSlice: number;
  };

  // Grouped state
  contours: {
    rtStructures: any;
    visibility: Map<number, boolean>;
    selectedStructures: Set<number>;
    editMode: boolean;
  };

  // Actions
  setSelectedSeries: (series: DICOMSeries) => void;
  toggleStructureVisibility: (id: number) => void;
}

const useViewerStore = create<ViewerStore>((set) => ({ /* ... */ }));
```

#### B. Memoization Strategy
```typescript
// Expensive computations should be memoized
const visibleStructureData = useMemo(() => {
  return rtStructures?.structures.filter(s =>
    structureVisibility.get(s.id) !== false
  );
}, [rtStructures, structureVisibility]); // Only recompute when these change

// Callbacks that get passed to children MUST be useCallback
const handleStructureToggle = useCallback((id: number) => {
  setStructureVisibility(prev => {
    const next = new Map(prev);
    next.set(id, !prev.get(id));
    return next;
  });
}, []); // No dependencies - uses functional update
```

#### C. Component Memoization
```typescript
// Prevent re-renders of expensive child components
const ContourOverlay = memo(({ structures, visibility, colors }) => {
  // Expensive canvas drawing operations
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if structure data changed
  return prevProps.structures === nextProps.structures &&
         prevProps.visibility === nextProps.visibility;
});
```

**Expected Impact:**
- 50-70% reduction in unnecessary re-renders
- Smoother interactions (especially during contouring)

---

### 5. Image Loading & Caching Strategy

**Problem:** No proper image caching, multiple fetches of same data.

**Current:** 94 direct `fetch()` calls, inconsistent caching.

**Solution:** Implement tiered caching

```typescript
// lib/image-cache.ts
class ImageCacheManager {
  private memoryCache = new Map<string, ImageData>(); // LRU, 200MB limit
  private diskCache: Cache; // Service Worker cache, 2GB limit

  async getImage(seriesId: number, instanceUID: string): Promise<ImageData> {
    const key = `${seriesId}/${instanceUID}`;

    // L1: Memory cache (instant)
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key)!;
    }

    // L2: Disk cache (fast)
    const cached = await this.diskCache.match(key);
    if (cached) {
      const data = await cached.arrayBuffer();
      const image = this.parseImage(data);
      this.memoryCache.set(key, image);
      return image;
    }

    // L3: Network (slow)
    const response = await fetch(`/api/series/${seriesId}/images/${instanceUID}`);
    const data = await response.arrayBuffer();

    // Cache for future
    this.diskCache.put(key, new Response(data));
    const image = this.parseImage(data);
    this.memoryCache.set(key, image);

    return image;
  }

  // Prefetch next/prev slices in background
  prefetch(seriesId: number, currentIndex: number, total: number) {
    const toFetch = [
      currentIndex + 1,
      currentIndex - 1,
      currentIndex + 2,
      currentIndex - 2,
    ].filter(i => i >= 0 && i < total);

    toFetch.forEach(index => this.getImage(seriesId, instances[index]));
  }
}
```

**Benefits:**
- Instant slice navigation (from memory cache)
- Offline viewing capability (disk cache)
- Reduced server load

---

### 6. Database Query Optimization

**Problem:** N+1 queries, missing indexes, inefficient queries.

**Issues Found:**
```typescript
// storage.ts - N+1 query pattern
async getStudiesByPatient(patientId: number) {
  const studies = await db.select().from(studies).where(eq(studies.patientId, patientId));

  // ❌ N+1: Loops and queries for each study
  for (const study of studies) {
    study.series = await this.getSeriesByStudyId(study.id); // Separate query!
  }
  return studies;
}
```

**Solution:** Use JOIN queries
```typescript
async getStudiesByPatient(patientId: number) {
  // ✅ Single query with JOIN
  const result = await db
    .select({
      study: studies,
      series: series,
    })
    .from(studies)
    .leftJoin(series, eq(series.studyId, studies.id))
    .where(eq(studies.patientId, patientId));

  // Group results
  return groupByStudy(result);
}
```

**Add Missing Indexes:**
```sql
-- Frequently queried columns need indexes
CREATE INDEX idx_series_study_id ON series(study_id);
CREATE INDEX idx_series_modality ON series(modality);
CREATE INDEX idx_images_series_id ON images(series_id);
CREATE INDEX idx_rt_structures_set_id ON rt_structures(rt_structure_set_id);

-- Composite indexes for common query patterns
CREATE INDEX idx_series_study_modality ON series(study_id, modality);
CREATE INDEX idx_images_series_position ON images(series_id, instance_number);
```

**Expected Impact:**
- Query time: 500ms → 50ms for typical patient load
- Database connection pool pressure reduced

---

## 🛠️ Code Quality Improvements

### 7. Logging Standardization

**Problem:** 855+ `console.log/warn/error` statements in frontend.

**Issues:**
- No structure
- No filtering capability
- Production logs pollute console
- No log aggregation

**Solution:** Frontend logger service

```typescript
// lib/logger.ts
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel = import.meta.env.PROD ? LogLevel.WARN : LogLevel.DEBUG;
  private buffer: LogEntry[] = [];

  debug(message: string, context?: string, data?: any) {
    this.log(LogLevel.DEBUG, message, context, data);
  }

  info(message: string, context?: string, data?: any) {
    this.log(LogLevel.INFO, message, context, data);
  }

  private log(level: LogLevel, message: string, context?: string, data?: any) {
    if (level < this.level) return;

    const entry = {
      timestamp: Date.now(),
      level: LogLevel[level],
      message,
      context,
      data,
    };

    // Console output with color coding
    const color = { DEBUG: 'gray', INFO: 'blue', WARN: 'orange', ERROR: 'red' }[entry.level];
    console.log(`%c[${entry.level}] ${context || 'App'}: ${message}`, `color: ${color}`, data);

    // Buffer for export/debug
    this.buffer.push(entry);
    if (this.buffer.length > 1000) this.buffer.shift();
  }

  // Export for bug reports
  export() {
    return JSON.stringify(this.buffer, null, 2);
  }
}

export const logger = new Logger();

// Usage
logger.debug('Loading DICOM image', 'ImageLoader', { seriesId: 123 });
logger.error('Failed to parse contour', 'ContourParser', error);
```

**Migration Strategy:**
```bash
# Replace console.log with logger
find client/src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' 's/console\.log/logger.debug/g'
find client/src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' 's/console\.warn/logger.warn/g'
find client/src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' 's/console\.error/logger.error/g'
```

---

### 8. TypeScript Type Safety

**Problem:** 93 legacy TypeScript errors suppressed, extensive use of `any`.

**Common Issues:**
```typescript
// ❌ Bad: Type erasure
const rtSet = rtStructureSets[0];
const structs = rtStructures.filter(s => s.rtStructureSetId === (rtSet as any).id);

// ✅ Good: Proper typing
interface RTStructureSet {
  id: number;
  seriesId: number;
  studyId: number;
  // ... other fields
}

const rtSet: RTStructureSet = rtStructureSets[0];
const structs = rtStructures.filter(s => s.rtStructureSetId === rtSet.id);
```

**Solution:** Incremental type improvement
1. Fix one file at a time (start with `shared/schema.ts` - already done ✅)
2. Add strict type checking to new files
3. Enable `strictNullChecks` in stages
4. Remove `as any` casts one by one

---

### 9. Testing Infrastructure

**Problem:** No tests visible in codebase.

**Recommendation:** Add critical path tests

```typescript
// __tests__/contour-operations.test.ts
import { describe, it, expect } from 'vitest';
import { MarginEngine } from '../lib/margins';

describe('MarginEngine', () => {
  it('should expand 2D contour by margin', () => {
    const contour = [
      [0, 0], [10, 0], [10, 10], [0, 10]
    ];

    const engine = new MarginEngine('2d');
    const result = engine.expand([{ points: contour.flat() }], 2.0);

    // Verify expansion
    expect(result[0].points.length).toBeGreaterThan(contour.length * 2);
  });

  it('should handle self-intersecting polygons', () => {
    // Test edge case
  });
});

// __tests__/image-cache.test.ts
describe('ImageCacheManager', () => {
  it('should return cached image without network call', async () => {
    const cache = new ImageCacheManager();

    // First call fetches
    const image1 = await cache.getImage(123, 'uid-1');

    // Second call returns cached
    const image2 = await cache.getImage(123, 'uid-1');

    expect(image1).toBe(image2); // Same reference
    expect(fetchMock).toHaveBeenCalledTimes(1); // Only once
  });
});
```

**Test Coverage Priority:**
1. Contour operations (margin expansion, boolean ops)
2. Image caching/loading
3. Fusion transform calculations
4. Database query logic
5. API endpoints

---

## 📱 User Experience Improvements

### 10. Progressive Loading UX

**Problem:** White screen during initial load, no feedback.

**Solution:** Skeleton screens and loading states

```typescript
// components/SkeletonViewer.tsx
export function SkeletonViewer() {
  return (
    <div className="animate-pulse">
      <div className="h-16 bg-gray-200 mb-4" /> {/* Toolbar */}
      <div className="flex gap-4">
        <div className="w-64 h-96 bg-gray-200" /> {/* Series list */}
        <div className="flex-1 h-96 bg-gray-300" /> {/* Viewer */}
      </div>
    </div>
  );
}

// viewer-interface.tsx
export function ViewerInterface({ studyData }: Props) {
  if (!studyData) return <SkeletonViewer />;

  return (
    <Suspense fallback={<SkeletonViewer />}>
      <ActualViewer studyData={studyData} />
    </Suspense>
  );
}
```

---

### 11. Error Boundary & Recovery

**Problem:** Errors crash entire app, no recovery path.

**Solution:** Granular error boundaries

```typescript
// components/ErrorBoundary.tsx
class ViewerErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.error('Viewer crashed', 'ErrorBoundary', { error, errorInfo });
    // Send to monitoring service (Sentry, etc.)
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="p-8 text-center">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <Button onClick={() => this.setState({ hasError: false })}>
            Try Again
          </Button>
          <Button onClick={() => window.location.reload()}>
            Reload Page
          </Button>
        </Card>
      );
    }

    return this.props.children;
  }
}

// Wrap critical sections
<ViewerErrorBoundary>
  <WorkingViewer {...props} />
</ViewerErrorBoundary>
```

---

### 12. Keyboard Shortcuts & Accessibility

**Problem:** Limited keyboard navigation, poor accessibility.

**Solution:** Comprehensive keyboard support

```typescript
// hooks/useKeyboardShortcuts.ts
export function useKeyboardShortcuts(actions: KeyboardActions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Tool selection
      if (e.key === 'p') actions.selectPanTool();
      if (e.key === 'b') actions.selectBrushTool();
      if (e.key === 'm') actions.selectMeasureTool();

      // Navigation
      if (e.key === 'ArrowUp') actions.nextSlice();
      if (e.key === 'ArrowDown') actions.prevSlice();

      // Undo/Redo
      if (e.ctrlKey && e.key === 'z') actions.undo();
      if (e.ctrlKey && e.shiftKey && e.key === 'z') actions.redo();

      // Visibility
      if (e.key === 'h') actions.toggleContours();
      if (e.key === 'f') actions.toggleFusion();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions]);
}
```

**Accessibility:**
- Add ARIA labels to all buttons/controls
- Keyboard focus management
- Screen reader announcements for state changes

---

## 🏗️ Architecture Improvements

### 13. API Layer Standardization

**Problem:** Inconsistent API response formats, error handling.

**Solution:** Standardized response wrapper

```typescript
// shared/api-types.ts
export type ApiResponse<T> =
  | { success: true; data: T; meta?: any }
  | { success: false; error: { code: string; message: string; details?: any } };

// server/middleware/api-wrapper.ts
export function apiHandler<T>(
  handler: (req: Request, res: Response) => Promise<T>
) {
  return async (req: Request, res: Response) => {
    try {
      const data = await handler(req, res);
      res.json({ success: true, data } as ApiResponse<T>);
    } catch (error) {
      logger.error('API error', req.path, error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        }
      } as ApiResponse<never>);
    }
  };
}

// Usage
app.get('/api/patients', apiHandler(async (req, res) => {
  const patients = await storage.getAllPatients();
  return patients; // Automatically wrapped in success response
}));
```

---

### 14. Feature Flags System

**Problem:** Hard to test new features, risky deployments.

**Solution:** Simple feature flag system

```typescript
// lib/feature-flags.ts
const FLAGS = {
  ENABLE_GPU_RENDERING: import.meta.env.VITE_ENABLE_GPU ?? false,
  ENABLE_FUSION_V2: import.meta.env.VITE_ENABLE_FUSION_V2 ?? false,
  ENABLE_EXPERIMENTAL_MARGINS: import.meta.env.VITE_ENABLE_EXP_MARGINS ?? false,
} as const;

export function useFeatureFlag(flag: keyof typeof FLAGS): boolean {
  return FLAGS[flag];
}

// Usage in components
export function WorkingViewer() {
  const useGPU = useFeatureFlag('ENABLE_GPU_RENDERING');

  return useGPU ? <GPURenderer /> : <CanvasRenderer />;
}
```

---

## 🎯 Implementation Roadmap

### Phase 1: Quick Wins (1-2 weeks)
- [ ] Add code splitting for vendor bundles (reduce bundle by 30%)
- [ ] Implement frontend logger and replace 100 most critical console.logs
- [ ] Add image prefetching for smoother slice navigation
- [ ] Create skeleton loading states
- [ ] Add error boundaries around viewer components

**Expected Impact:** Immediate UX improvement, easier debugging

---

### Phase 2: Component Refactoring (3-4 weeks)
- [ ] Extract `working-viewer.tsx` into 5-7 focused components
- [ ] Extract `viewer-interface.tsx` state into Zustand store
- [ ] Consolidate 19 margin files into unified `margins/` module
- [ ] Add React.memo and useMemo to prevent unnecessary re-renders

**Expected Impact:** 50% reduction in re-renders, much more maintainable code

---

### Phase 3: Performance Optimization (2-3 weeks)
- [ ] Implement tiered image caching (memory + disk)
- [ ] Optimize database queries (add indexes, eliminate N+1)
- [ ] Lazy load heavy features (fusion, boolean ops, advanced margins)
- [ ] Move heavy computation to Web Workers

**Expected Impact:** 2-3x faster image loading, 60% faster initial load

---

### Phase 4: Quality & Testing (3-4 weeks)
- [ ] Add unit tests for critical paths (80% coverage target)
- [ ] Fix TypeScript errors incrementally (10 files per week)
- [ ] Add E2E tests for core workflows (Playwright)
- [ ] Set up continuous performance monitoring

**Expected Impact:** Fewer regressions, confident deployments

---

## 📊 Metrics to Track

### Performance Metrics
- **Bundle Size:** Target <800 KB main bundle
- **Time to Interactive:** Target <3s on 3G
- **Memory Usage:** Target <500 MB for typical session
- **Image Load Time:** Target <100ms for cached, <500ms for network

### Code Quality Metrics
- **TypeScript Coverage:** Target 100% (zero `any` types)
- **Test Coverage:** Target 80%+ for critical paths
- **Component Size:** No component >500 lines
- **Cyclomatic Complexity:** Keep functions <10 complexity

### User Experience Metrics
- **Error Rate:** Target <1% of sessions
- **Crash Rate:** Target <0.1%
- **User Satisfaction:** Track via feedback/ratings

---

## 🔧 Tools & Libraries to Add

### Development
```json
{
  "vitest": "^1.0.0",           // Fast unit testing
  "playwright": "^1.40.0",       // E2E testing
  "@testing-library/react": "^14.0.0",
  "msw": "^2.0.0",              // API mocking
  "bundle-analyzer": "^4.0.0"    // Bundle analysis
}
```

### Performance
```json
{
  "zustand": "^4.4.0",          // State management
  "immer": "^10.0.0",           // Immutable updates
  "react-virtuoso": "^4.6.0",   // Virtual scrolling
  "workbox": "^7.0.0"           // Service worker
}
```

### Monitoring
```json
{
  "@sentry/react": "^7.0.0",    // Error tracking
  "web-vitals": "^3.5.0"        // Performance monitoring
}
```

---

## 💡 Final Recommendations

### Immediate Actions (This Week)
1. **Enable bundle analyzer** - See what's taking up space
2. **Add error boundaries** - Prevent full app crashes
3. **Implement logging service** - Better debugging
4. **Add loading skeletons** - Better perceived performance

### High-ROI Improvements (Next Month)
1. **Code split vendor bundles** - 30-40% bundle reduction
2. **Refactor working-viewer.tsx** - Make codebase maintainable
3. **Implement image caching** - 10x faster slice navigation
4. **Consolidate margin implementations** - Reduce confusion

### Long-Term Investments (Next Quarter)
1. **Comprehensive test suite** - Enable confident refactoring
2. **TypeScript strict mode** - Catch bugs at compile time
3. **Performance monitoring** - Proactive issue detection
4. **Documentation** - Architecture, API docs, dev guides

---

## 📝 Notes

- All estimates assume 1-2 developers working on improvements
- Prioritize based on user pain points and business impact
- Don't try to do everything at once - incremental improvements are safer
- Measure before and after each optimization to validate impact
- Keep the app working during refactoring - feature flags help

---

Generated: 2025-09-29
Version: 1.0
Author: Claude (Code Analysis Agent)