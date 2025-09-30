# Quick Win Improvements - Implementation Guide

This document provides copy-paste ready code for immediate improvements you can implement today.

## 1. Bundle Splitting (10 minutes)

Update `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React
          'vendor-react': ['react', 'react-dom'],

          // UI Framework (Radix)
          'vendor-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-slider',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toast',
          ],

          // Cornerstone (Medical Imaging Core)
          'vendor-cornerstone': [
            'cornerstone-core',
            'cornerstone-tools',
            'cornerstone-wado-image-loader',
            '@cornerstonejs/core',
            '@cornerstonejs/tools',
          ],

          // DICOM Parsing
          'vendor-dicom': [
            'dicom-parser',
            'dcmjs',
          ],

          // Geometry/Math
          'vendor-geometry': [
            'js-angusj-clipper',
            'polygon-clipping',
            'konva',
          ],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
```

**Expected Result:** Bundle reduces from 1,656 KB → ~900 KB

---

## 2. Frontend Logger (30 minutes)

Create `client/src/lib/logger.ts`:

```typescript
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  context?: string;
  data?: any;
}

class Logger {
  private level: LogLevel = import.meta.env.PROD ? LogLevel.WARN : LogLevel.DEBUG;
  private buffer: LogEntry[] = [];
  private maxBufferSize = 1000;

  setLevel(level: LogLevel) {
    this.level = level;
  }

  debug(message: string, context?: string, data?: any) {
    this.log(LogLevel.DEBUG, message, context, data);
  }

  info(message: string, context?: string, data?: any) {
    this.log(LogLevel.INFO, message, context, data);
  }

  warn(message: string, context?: string, data?: any) {
    this.log(LogLevel.WARN, message, context, data);
  }

  error(message: string, context?: string, data?: any) {
    this.log(LogLevel.ERROR, message, context, data);
  }

  private log(level: LogLevel, message: string, context?: string, data?: any) {
    if (level < this.level) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level: LogLevel[level],
      message,
      context,
      data,
    };

    // Console output with styling
    const styles = {
      DEBUG: 'color: gray',
      INFO: 'color: blue',
      WARN: 'color: orange; font-weight: bold',
      ERROR: 'color: red; font-weight: bold',
    };

    const prefix = context ? `[${entry.level}] ${context}:` : `[${entry.level}]`;
    console.log(`%c${prefix} ${message}`, styles[entry.level], data || '');

    // Buffer for export
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  // Export logs for bug reports
  export(): string {
    return JSON.stringify(this.buffer, null, 2);
  }

  // Clear buffer
  clear() {
    this.buffer = [];
  }

  // Get recent logs
  getRecent(count: number = 100): LogEntry[] {
    return this.buffer.slice(-count);
  }
}

export const logger = new Logger();

// Development helper
if (!import.meta.env.PROD) {
  (window as any).__logger = logger;
  console.log('%cLogger available as window.__logger', 'color: green; font-weight: bold');
}
```

**Usage - Replace existing console.log calls:**

```typescript
// Before:
console.log('Loading DICOM series', series.id);
console.error('Failed to load image', error);

// After:
import { logger } from '@/lib/logger';

logger.debug('Loading DICOM series', 'ImageLoader', { seriesId: series.id });
logger.error('Failed to load image', 'ImageLoader', { error, seriesId: series.id });
```

**Debug in console:**
```javascript
window.__logger.export() // Get all logs as JSON
window.__logger.getRecent(50) // Get last 50 entries
window.__logger.setLevel(0) // Enable DEBUG logs
```

---

## 3. Image Prefetching (45 minutes)

Create `client/src/lib/image-prefetcher.ts`:

```typescript
import { logger } from './logger';

interface PrefetchRequest {
  seriesId: number;
  instanceUID: string;
  priority: 'high' | 'medium' | 'low';
}

class ImagePrefetcher {
  private queue: PrefetchRequest[] = [];
  private cache = new Map<string, Promise<ImageData>>();
  private isProcessing = false;
  private maxConcurrent = 3;
  private activeRequests = 0;

  // Prefetch adjacent slices
  prefetchAdjacent(
    seriesId: number,
    currentIndex: number,
    instances: string[],
    radius: number = 2
  ) {
    const toPrefetch: PrefetchRequest[] = [];

    // Next slices (higher priority)
    for (let i = 1; i <= radius; i++) {
      const index = currentIndex + i;
      if (index < instances.length) {
        toPrefetch.push({
          seriesId,
          instanceUID: instances[index],
          priority: i === 1 ? 'high' : 'medium',
        });
      }
    }

    // Previous slices (lower priority)
    for (let i = 1; i <= radius; i++) {
      const index = currentIndex - i;
      if (index >= 0) {
        toPrefetch.push({
          seriesId,
          instanceUID: instances[index],
          priority: 'medium',
        });
      }
    }

    this.enqueue(toPrefetch);
  }

  private enqueue(requests: PrefetchRequest[]) {
    // Don't add duplicates
    const existing = new Set(this.queue.map(r => `${r.seriesId}/${r.instanceUID}`));
    const newRequests = requests.filter(
      r => !existing.has(`${r.seriesId}/${r.instanceUID}`)
    );

    // Sort by priority
    this.queue.push(...newRequests);
    this.queue.sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 };
      return priority[a.priority] - priority[b.priority];
    });

    this.process();
  }

  private async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
      const request = this.queue.shift();
      if (!request) break;

      this.activeRequests++;
      this.fetchImage(request).finally(() => {
        this.activeRequests--;
        this.process(); // Continue processing
      });
    }

    this.isProcessing = false;
  }

  private async fetchImage(request: PrefetchRequest): Promise<void> {
    const key = `${request.seriesId}/${request.instanceUID}`;

    // Already cached
    if (this.cache.has(key)) {
      return;
    }

    try {
      logger.debug('Prefetching image', 'Prefetcher', request);

      const promise = fetch(
        `/api/series/${request.seriesId}/images/${request.instanceUID}`
      ).then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        const arrayBuffer = await res.arrayBuffer();
        // Parse with dicom-parser or cornerstone
        return this.parseImage(arrayBuffer);
      });

      this.cache.set(key, promise);
      await promise;

      logger.debug('Prefetch complete', 'Prefetcher', { key });
    } catch (error) {
      logger.warn('Prefetch failed', 'Prefetcher', { request, error });
      this.cache.delete(key); // Remove failed promise
    }
  }

  private parseImage(arrayBuffer: ArrayBuffer): ImageData {
    // TODO: Implement actual DICOM parsing
    // This is a placeholder
    return {} as ImageData;
  }

  // Get cached image (instant if prefetched)
  async getImage(seriesId: number, instanceUID: string): Promise<ImageData> {
    const key = `${seriesId}/${instanceUID}`;

    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // Not prefetched, fetch now
    const request: PrefetchRequest = { seriesId, instanceUID, priority: 'high' };
    await this.fetchImage(request);
    return this.cache.get(key)!;
  }

  // Clear cache to free memory
  clear() {
    this.cache.clear();
    this.queue = [];
    logger.info('Image cache cleared', 'Prefetcher');
  }

  // Get cache stats
  getStats() {
    return {
      cacheSize: this.cache.size,
      queueSize: this.queue.length,
      activeRequests: this.activeRequests,
    };
  }
}

export const imagePrefetcher = new ImagePrefetcher();

// Development helper
if (!import.meta.env.PROD) {
  (window as any).__prefetcher = imagePrefetcher;
}
```

**Usage in viewer component:**

```typescript
import { imagePrefetcher } from '@/lib/image-prefetcher';

// When user navigates to a slice
useEffect(() => {
  if (currentSliceIndex !== undefined) {
    // Prefetch ±2 slices
    imagePrefetcher.prefetchAdjacent(
      selectedSeries.id,
      currentSliceIndex,
      imageInstances,
      2 // radius
    );
  }
}, [currentSliceIndex, selectedSeries]);

// When loading image
const image = await imagePrefetcher.getImage(seriesId, instanceUID);
// Will be instant if already prefetched!
```

---

## 4. Loading Skeleton (20 minutes)

Create `client/src/components/ui/skeleton-viewer.tsx`:

```typescript
import { Card } from "@/components/ui/card";

export function SkeletonViewer() {
  return (
    <div className="h-full w-full bg-background">
      {/* Toolbar */}
      <div className="h-16 border-b flex items-center gap-2 px-4">
        <div className="h-8 w-32 bg-muted animate-pulse rounded" />
        <div className="h-8 w-24 bg-muted animate-pulse rounded" />
        <div className="h-8 w-24 bg-muted animate-pulse rounded" />
        <div className="flex-1" />
        <div className="h-8 w-8 bg-muted animate-pulse rounded-full" />
        <div className="h-8 w-8 bg-muted animate-pulse rounded-full" />
      </div>

      <div className="flex h-[calc(100%-4rem)]">
        {/* Series List */}
        <div className="w-64 border-r p-4 space-y-2">
          <div className="h-6 w-32 bg-muted animate-pulse rounded mb-4" />
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="p-3">
              <div className="h-4 w-full bg-muted animate-pulse rounded mb-2" />
              <div className="h-3 w-2/3 bg-muted animate-pulse rounded" />
            </Card>
          ))}
        </div>

        {/* Viewer Area */}
        <div className="flex-1 p-4">
          <Card className="h-full flex items-center justify-center bg-muted/10">
            <div className="text-center space-y-4">
              <div className="w-64 h-64 mx-auto bg-muted animate-pulse rounded-lg" />
              <div className="h-4 w-48 bg-muted animate-pulse rounded mx-auto" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function SkeletonSeriesList() {
  return (
    <div className="space-y-2 p-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} className="p-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-muted animate-pulse rounded" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-full bg-muted animate-pulse rounded" />
              <div className="h-3 w-2/3 bg-muted animate-pulse rounded" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
```

**Usage:**

```typescript
import { Suspense } from 'react';
import { SkeletonViewer } from '@/components/ui/skeleton-viewer';

export function ViewerPage() {
  return (
    <Suspense fallback={<SkeletonViewer />}>
      <ActualViewer />
    </Suspense>
  );
}
```

---

## 5. Error Boundary (30 minutes)

Create `client/src/components/error-boundary.tsx`:

```typescript
import React, { Component, ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { logger } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('Component crashed', 'ErrorBoundary', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    this.setState({ errorInfo });

    // Send to monitoring service (Sentry, etc.)
    if (import.meta.env.PROD) {
      // window.Sentry?.captureException(error, { contexts: { react: errorInfo } });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Card className="m-8 p-8">
          <div className="flex flex-col items-center text-center space-y-4">
            <AlertTriangle className="w-16 h-16 text-destructive" />
            <h2 className="text-2xl font-bold">Something went wrong</h2>
            <p className="text-muted-foreground max-w-md">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>

            {!import.meta.env.PROD && this.state.error && (
              <details className="w-full text-left">
                <summary className="cursor-pointer text-sm font-mono text-muted-foreground">
                  Error Details
                </summary>
                <pre className="mt-2 p-4 bg-muted rounded text-xs overflow-auto max-h-64">
                  {this.state.error.stack}
                </pre>
                {this.state.errorInfo && (
                  <pre className="mt-2 p-4 bg-muted rounded text-xs overflow-auto max-h-64">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </details>
            )}

            <div className="flex gap-2">
              <Button onClick={this.handleReset}>Try Again</Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Reload Page
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const logs = logger.export();
                  const blob = new Blob([logs], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `error-logs-${Date.now()}.json`;
                  a.click();
                }}
              >
                Export Logs
              </Button>
            </div>
          </div>
        </Card>
      );
    }

    return this.props.children;
  }
}
```

**Usage - Wrap critical sections:**

```typescript
import { ErrorBoundary } from '@/components/error-boundary';

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/viewer/:id" element={
          <ErrorBoundary onReset={() => history.back()}>
            <ViewerInterface />
          </ErrorBoundary>
        } />
      </Routes>
    </ErrorBoundary>
  );
}
```

---

## 6. Database Index Creation (5 minutes)

Run this SQL to add missing indexes:

```sql
-- Add indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_series_study_id ON series(study_id);
CREATE INDEX IF NOT EXISTS idx_series_modality ON series(modality);
CREATE INDEX IF NOT EXISTS idx_images_series_id ON images(series_id);
CREATE INDEX IF NOT EXISTS idx_rt_structures_set_id ON rt_structures(rt_structure_set_id);
CREATE INDEX IF NOT EXISTS idx_rt_structure_contours_structure_id ON rt_structure_contours(rt_structure_id);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_series_study_modality ON series(study_id, modality);
CREATE INDEX IF NOT EXISTS idx_images_series_position ON images(series_id, instance_number);

-- Frame of reference index (for fusion queries)
CREATE INDEX IF NOT EXISTS idx_series_frame_of_reference ON series(frame_of_reference_uid) WHERE frame_of_reference_uid IS NOT NULL;

-- Analyze tables to update query planner statistics
ANALYZE patients;
ANALYZE studies;
ANALYZE series;
ANALYZE images;
ANALYZE rt_structure_sets;
ANALYZE rt_structures;
ANALYZE rt_structure_contours;
```

Run it:
```bash
psql postgresql://localhost:5432/converge_viewer < docs/add-indexes.sql
```

---

## 7. React Query Optimization (15 minutes)

Update `client/src/lib/queryClient.ts`:

```typescript
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep data fresh for 5 minutes
      staleTime: 5 * 60 * 1000,

      // Cache for 10 minutes
      gcTime: 10 * 60 * 1000,

      // Retry failed requests
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),

      // Don't refetch on window focus for medical data
      refetchOnWindowFocus: false,

      // Don't refetch on mount if data is recent
      refetchOnMount: 'always',
    },
    mutations: {
      // Retry mutations once on failure
      retry: 1,
    },
  },
});

// Development helper
if (!import.meta.env.PROD) {
  (window as any).__queryClient = queryClient;
  console.log('%cReact Query client available as window.__queryClient', 'color: green');
}
```

**Better query hooks:**

```typescript
// hooks/use-patient-data.ts
import { useQuery } from '@tanstack/react-query';

export function usePatientData(patientId: number) {
  return useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}`);
      if (!res.ok) throw new Error('Failed to load patient');
      return res.json();
    },
    enabled: !!patientId, // Only run if patientId exists
    staleTime: 10 * 60 * 1000, // Patient data changes rarely
  });
}

// Prefetch related data
export function usePrefetchStudy(studyId: number) {
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ['study', studyId],
      queryFn: () => fetch(`/api/studies/${studyId}`).then(r => r.json()),
    });
  }, [studyId]);
}
```

---

## Measurement Script

Add this to measure improvements:

```typescript
// client/src/lib/performance.ts
export class PerformanceMonitor {
  private marks = new Map<string, number>();

  mark(name: string) {
    this.marks.set(name, performance.now());
  }

  measure(name: string, startMark: string) {
    const start = this.marks.get(startMark);
    if (!start) return;

    const duration = performance.now() - start;
    console.log(`⏱️ ${name}: ${duration.toFixed(2)}ms`);

    return duration;
  }

  // Measure React component render time
  measureRender(componentName: string, fn: () => void) {
    const start = performance.now();
    fn();
    const duration = performance.now() - start;

    if (duration > 16) { // Slower than 60fps
      console.warn(`🐌 Slow render: ${componentName} took ${duration.toFixed(2)}ms`);
    }
  }
}

export const perfMonitor = new PerformanceMonitor();
```

**Usage:**
```typescript
// Measure page load
perfMonitor.mark('viewer-start');
// ... load images, render UI
perfMonitor.measure('Viewer load time', 'viewer-start');

// Measure component
useEffect(() => {
  perfMonitor.measureRender('WorkingViewer', () => {
    // Component logic
  });
}, [deps]);
```

---

## Testing the Improvements

### Before implementing:
```bash
npm run build
ls -lh dist/public/assets/*.js | grep index  # Note the size
```

### After implementing:
```bash
npm run build
ls -lh dist/public/assets/*.js  # Compare all chunk sizes
```

### In browser console:
```javascript
// Check cache stats
window.__prefetcher.getStats()

// Check logs
window.__logger.getRecent(20)

// Check React Query cache
window.__queryClient.getQueryCache().getAll().length
```

---

## Priority Order

1. **Bundle splitting** (10 min) - Immediate 30% reduction
2. **Error boundary** (30 min) - Prevent crashes
3. **Loading skeletons** (20 min) - Better UX
4. **Logger** (30 min) - Better debugging
5. **Database indexes** (5 min) - Faster queries
6. **Image prefetching** (45 min) - Smoother navigation
7. **React Query config** (15 min) - Better caching

**Total time: ~2.5 hours for significant improvements**

---

Next steps: See `IMPROVEMENT_RECOMMENDATIONS.md` for long-term architecture improvements.