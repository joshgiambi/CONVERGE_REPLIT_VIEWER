# Viewer Function Mapping & Migration Plan

**Generated**: 2025-02-01
**Purpose**: Complete inventory of all functions in viewer-interface.tsx and working-viewer.tsx with migration targets

## Executive Summary

- **viewer-interface.tsx**: 2,270 lines, ~45 major functions
- **working-viewer.tsx**: 6,419 lines, ~120+ functions
- **Total complexity**: ~8,700 lines to refactor
- **Strategy**: Parallel implementation → gradual migration → deprecation

---

## viewer-interface.tsx - Function Inventory (2,270 lines)

### Data Fetching & Series Management (Lines 1-706)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `ViewerInterface` (main) | 42-2269 | Main component wrapper | **ViewerPage** | All below |
| `shouldHideSeries` | 166-227 | Filter derived/resampled series | **SeriesFilterService** | seriesSelectionData |
| `useQuery` (series fetch) | 229-266 | Fetch all series for studies | **useSeriesData** hook | studyData |
| `loadAssociations` | 270-649 | Load registration associations | **useRegistrationOptions** hook | seriesData, studyData |
| `handleSeriesSelect` | 670-706 | Handle series selection & load images | **PrimaryViewport** | None (core action) |

**Migration Plan - Data Layer**:
1. Create `hooks/useSeriesData.ts` - wrap series fetching
2. Create `hooks/useRegistrationOptions.ts` - registration logic
3. Create `services/SeriesFilterService.ts` - filtering logic
4. **Risk**: Registration loading is 380 lines of complex normalization - needs careful extraction

---

### Toolbar & Tool Management (Lines 707-817)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `handleZoomIn` | 708-716 | Zoom in via global window | **ViewportControls** | window.currentViewerZoom |
| `handleZoomOut` | 718-726 | Zoom out via global window | **ViewportControls** | window.currentViewerZoom |
| `handleResetZoom` | 728-736 | Reset zoom via global window | **ViewportControls** | window.currentViewerZoom |
| `setActiveTool` | 738-751 | Set cornerstone tool active | **ViewportControls** | cornerstoneTools |
| `handlePanTool` | 753-758 | Activate pan mode | **ViewportControls** | workingViewerRef |
| `handleMeasureTool` | 760-763 | Activate measurement tool | **ViewportControls** | setActiveTool |
| `handleAnnotateTool` | 764 | Activate arrow annotation | **ViewportControls** | setActiveTool |
| `handleCrosshairsTool` | 766-771 | Activate crosshair mode | **ViewportControls** | workingViewerRef |
| `handleRotate` | 773-794 | Rotate image 90° | **ViewportControls** | window.cornerstone |
| `handleFlip` | 796-817 | Flip image horizontally | **ViewportControls** | window.cornerstone |

**Migration Plan - Toolbar**:
1. Extract to `components/viewer/ViewportControls.tsx`
2. Create `hooks/useViewportTools.ts` for tool state
3. Remove global `window.currentViewerZoom` - use controlled state
4. **Risk**: Dependencies on WorkingViewer refs - needs coordination

---

### RT Structure Management (Lines 819-898)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `handleRTStructureLoad` | 819-828 | Load RT structures | **RTOverlayLayer** | None |
| `handleRTSeriesSelect` | 830-849 | Auto-load RT on series select | **RTProvider** | selectedSeries |
| `handleStructureSelection` | 851-872 | Handle structure selection | **RTControlPanel** | selectedStructures state |
| `handleStructureVisibilityChange` | 874-883 | Toggle structure visibility | **RTControlPanel** | structureVisibility map |
| `handleAllStructuresVisibilityChange` | 885-887 | Toggle all structures | **RTControlPanel** | allStructuresVisible |
| `handleStructureColorChange` | 889-898 | Change structure color | **RTControlPanel** | rtStructures |

**Migration Plan - RT Structures**:
1. Create `rt-structures/RTProvider.tsx` - owns RT state
2. Create `rt-structures/components/RTControlPanel.tsx` - UI controls
3. Create `rt-structures/components/RTOverlayLayer.tsx` - rendering
4. Create `hooks/useRTStructures.ts` - data management
5. **Risk**: Medium - RT logic is relatively isolated

---

### Fusion Candidate Resolution (Lines 900-1087)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `seriesById` memo | 900-910 | Map series by ID | **Keep in provider** | series array |
| `visibleSeriesIdSet` memo | 912-922 | Set of visible series IDs | **Keep in provider** | visibleSeries |
| `seriesByFoR` memo | 924-946 | Group series by Frame of Reference | **Keep in provider** | visibleSeries |
| `getCandidateSecondaryIds` | 948-1046 | Graph traversal for fusion candidates | **useFusionCandidates** hook | regAssociations, registrationRelationshipMap |
| `legacyFusionCandidates` memo | 1048-1057 | Build fusion candidate map | **useFusionCandidates** hook | getCandidateSecondaryIds |
| `fusionCandidatesByPrimary` memo | 1059-1068 | Merge legacy + manifest candidates | **useFusionCandidates** hook | seriesSelectionData |
| `fusionSiblingMap` memo | 1089-1250 | Complex PET/MR sibling mapping | **useFusionCandidates** hook | registrationRelationshipMap |

**Migration Plan - Fusion Resolution**:
1. Create `fusion/hooks/useFusionCandidates.ts` - 400 lines of complex logic
2. Move all memoized maps into this hook
3. **CRITICAL RISK**: This is the most complex logic - 350 lines of graph traversal, modality filtering, FoR matching
4. **Testing Required**: Extensive testing with multiple datasets before migration

---

### Contour Editing & Operations (Lines 1273-1475)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `handleContourUpdate` | 1273-1291 | Process contour updates | **RTProvider** | workingViewerRef |
| `handleGlobalUndo` | 1294-1299 | Global undo handler | **RTProvider** | undoRedoManager |
| `handleGlobalRedo` | 1301-1306 | Global redo handler | **RTProvider** | undoRedoManager |
| `handleJumpToHistory` | 1308-1313 | Jump to history state | **RTProvider** | undoRedoManager |
| `getStructureBounds` | 1341-1367 | Calculate structure bounds | **RTProvider** | structure contours |
| `getAutoZoomForBounds` | 1369-1381 | Calculate zoom for bounds | **ViewportControls** | canvas dimensions |
| `handleStructureLocalization` | 1412-1475 | Navigate to structure center | **RTControlPanel** | rtStructures, workingViewerRef |
| `handleLocalizationToggle` | 1478-1487 | Toggle localization mode | **RTControlPanel** | showLocalizationTool |

**Migration Plan - Contour Operations**:
1. Move to `rt-structures/RTProvider.tsx`
2. Extract undo/redo into `rt-structures/services/UndoRedoService.ts`
3. **Risk**: Low - relatively isolated

---

### Render Composition (Lines 1500-2262)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `FusionContent` | 1500-2262 | Main render composition | **ViewerV2** | All fusion hooks |
| Boolean operations (1842-2171) | 1842-2171 | Boolean operation logic | **BooleanOperationsPanel** | rtStructures |
| Margin toolbar (2179-2235) | 2179-2235 | Margin operation UI | **MarginToolbar** | rtStructures, workingViewerRef |

**Migration Plan - Render**:
1. Extract to `components/viewer/ViewerV2.tsx`
2. **Challenge**: 750 lines of nested render logic
3. Needs decomposition into smaller render functions

---

## working-viewer.tsx - Function Inventory (6,419 lines)

### Core Image Loading & Display (Lines 1-1018)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `WorkingViewer` (main) | 157-6419 | Main viewer component | **PrimaryViewport** | All below |
| `parseImagePosition` | 303-325 | Parse DICOM image position | **DICOMMetadataService** | None |
| `requestFusionOverlay` | 247-267 | Request fusion overlay | **FusionOverlayLayer** | fusionManager |
| `drawFusionOverlay` | 446-487 | Draw fusion on canvas | **FusionOverlayLayer** | canvas context |
| `convertSliceToCanvas` | 489-505 | Convert fusebox slice to canvas | **FusionOverlayLayer** | fusionWindowLevel |
| `buildFuseboxCacheKey` | 440-444 | Build fusion cache key | **FusionOverlayLayer** | seriesId, secondaryId |
| `prefetchFusionSlices` | 528-634 | Prefetch fusion slices | **FusionOverlayLayer** | manifest status |
| `compileFusionDebug` | 667-717 | Compile fusion debug info | **useFusionDebug** hook | All fusion state |
| `pushFusionLog` | 719-725 | Add fusion log entry | **useFusionDebug** hook | fusionLogs |
| `handleRegistrationSelect` | 727-733 | Select registration method | **FusionPanel** | registrationOptions |
| `openFusionDebug` | 735-740 | Open fusion debug panel | **FusionDebugPanel** | compileFusionDebug |
| `openRegDetails` | 742-796 | Show registration details | **FusionPanel** | registrationMatrix |
| `scheduleRender` | 853-900 | Throttle render calls | **PrimaryViewport** | displayCurrentImage |

**Migration Plan - Core Rendering**:
1. Extract to `components/viewer/PrimaryViewport.tsx` (~800 lines)
2. Create `services/DICOMMetadataService.ts` - DICOM parsing
3. Create `fusion/components/FusionOverlayLayer.tsx` (~400 lines)
4. Create `fusion/hooks/useFusionDebug.ts` - debug tooling
5. **CRITICAL**: scheduleRender and render pipeline is complex - 50+ lines

---

### DICOM Worker & Image Processing (Lines 1019-2500)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `loadImages` | ~2100 | Load DICOM images via worker | **useDICOMImages** hook | dicomWorkerManager |
| `displayCurrentImage` | ~2400 | Render current image | **PrimaryViewport** | canvasRef, images |
| `renderRTStructures` | ~3100 | Draw RT contours | **RTOverlayLayer** | rtStructures, canvas |
| `renderMeasurements` | ~3300 | Draw measurements | **MeasurementOverlay** | measurements |
| GPU rendering functions | Multiple | GPU-accelerated rendering | **GPUViewportManager** | cornerstone3D |

**Migration Plan - Image Processing**:
1. Create `hooks/useDICOMImages.ts` - wraps worker loading
2. Create `services/DICOMWorkerManager.ts` (already exists, needs integration)
3. Create `services/GPUViewportManager.ts` (already exists)
4. **ULTRA CRITICAL**: displayCurrentImage is 300+ lines of complex rendering logic

---

### Mouse Interaction & Canvas Events (Lines 2500-3500)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `handleMouseDown` | ~2600 | Mouse down event | **PrimaryViewport** | brushTool state |
| `handleMouseMove` | ~2700 | Mouse move event | **PrimaryViewport** | pan/windowing |
| `handleMouseUp` | ~2800 | Mouse up event | **PrimaryViewport** | tool state |
| `handleWheel` | ~2900 | Mouse wheel scroll | **PrimaryViewport** | currentIndex |
| `handleKeyDown` | ~3000 | Keyboard shortcuts | **ViewportControls** | tool state |

**Migration Plan - Interactions**:
1. Extract to `hooks/useViewportInteractions.ts`
2. Create event handlers object
3. Pass to PrimaryViewport
4. **Risk**: Medium - 900 lines of event handling logic

---

### Contour Editing Tools (Lines 3500-5000)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `handleContourUpdate` (internal) | ~3600 | Process contour updates | **RTOverlayLayer** | rtStructures |
| `handleBooleanOperation` | 1048-1153 | Boolean ops (combine/subtract) | **RTProvider** | rtStructures |
| `handleMarginOperation` | 1156-1269 | Margin operations | **RTProvider** | rtStructures |
| `handlePreviewGrowOperation` | 1272-1332 | Preview grow single slice | **RTProvider** | rtStructures |
| `handleGrowContour` | 1335-1417 | Grow/shrink contour | **RTProvider** | rtStructures |
| `handlePreviewGrowStructure` | 1420-1498 | Preview grow all slices | **RTProvider** | rtStructures |
| Brush operations | Multiple | Brush stroke processing | **RTProvider** | brushToolState |
| Pen tool handlers | Multiple | Pen tool operations | **RTProvider** | pen tool state |

**Migration Plan - Contour Tools**:
1. Extract to `rt-structures/services/ContourOperationsService.ts`
2. 1,500+ lines of contour manipulation
3. **CRITICAL RISK**: This is the most complex RT logic

---

### MPR & Multi-Viewport (Lines 5000-6000)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| MPR rendering | Multiple | Multi-planar reconstruction | **MPRViewport** | mprCache |
| Sagittal/coronal display | Multiple | Orthogonal views | **MPRViewport** | images |
| Volume processing | Multiple | 3D volume handling | **VolumeService** | images array |

**Migration Plan - MPR**:
1. Extract to `components/viewer/MPRViewport.tsx`
2. Create `services/VolumeService.ts` for 3D processing
3. **Risk**: High - 1,000+ lines of 3D rendering

---

### Registration & Transform Management (Lines 327-438)

| Function | Lines | Purpose | Migration Target | Dependencies |
|----------|-------|---------|------------------|--------------|
| `registrationOptions` memo | 327-438 | Build registration options | **useRegistrationOptions** hook | registrationAssociations |

**Migration Plan - Registration**:
1. Move to `fusion/hooks/useRegistrationOptions.ts`
2. **Complexity**: 111 lines of option building with candidate filtering

---

## Migration Sequence

### Phase 1: Foundation (Week 1-2)
**Goal**: Build new architecture without touching old code

1. **Create directory structure**
   ```
   client/src/
   ├── components/viewer/          # General viewer components
   ├── fusion/                      # Fusion-specific (exists)
   ├── rt-structures/               # RT-specific (new)
   └── services/                    # Shared services (new)
   ```

2. **Create core services** (can run in parallel)
   - [ ] `services/DICOMMetadataService.ts` - 200 lines
   - [ ] `services/SeriesFilterService.ts` - 100 lines
   - [ ] `services/VolumeService.ts` - 300 lines

3. **Create foundation hooks**
   - [ ] `hooks/useSeriesData.ts` - 150 lines
   - [ ] `hooks/useDICOMImages.ts` - 250 lines
   - [ ] `hooks/useViewportInteractions.ts` - 400 lines
   - [ ] `hooks/useViewportTools.ts` - 200 lines

**Estimated Effort**: 1,600 lines, 2 weeks

---

### Phase 2: Viewer Core (Week 3-5)
**Goal**: Build basic viewer that can display DICOM without fusion or RT

4. **Build ViewportControls** 
   - [ ] `components/viewer/ViewportControls.tsx` - 300 lines
   - Extract all toolbar handlers (zoom, pan, rotate, flip)
   - Remove `window.currentViewerZoom` dependency

5. **Build PrimaryViewport**
   - [ ] `components/viewer/PrimaryViewport.tsx` - 800 lines
   - Core canvas rendering
   - Mouse interactions
   - Window/level
   - **WITHOUT** fusion or RT overlays initially

6. **Build ViewerShell**
   - [ ] Update `components/viewer/ViewerShell.tsx` - 200 lines
   - Layout orchestration
   - Sidebar positioning

7. **Build ViewerV2 entry point**
   - [ ] `components/viewer/ViewerV2.tsx` - 400 lines
   - Compose all components
   - Basic CT viewing only

8. **Add test route**
   - [ ] Update routing to add `/viewer-v2/:patientId/:seriesId`
   - Test with basic CT series

**Estimated Effort**: 1,700 lines, 3 weeks

---

### Phase 3: Fusion Integration (Week 6-8)
**Goal**: Add fusion overlay capability

9. **Extract fusion logic**
   - [ ] `fusion/hooks/useFusionCandidates.ts` - 400 lines (COMPLEX)
   - [ ] `fusion/hooks/useRegistrationOptions.ts` - 150 lines
   - [ ] `fusion/hooks/useFusionDebug.ts` - 200 lines

10. **Build FusionOverlayLayer**
    - [ ] `fusion/components/FusionOverlayLayer.tsx` - 600 lines
    - All fusion rendering logic
    - Cache management
    - Prefetch logic

11. **Integrate into ViewerV2**
    - Plug FusionOverlayLayer into PrimaryViewport
    - Test with PET/CT fusion

**Estimated Effort**: 1,350 lines, 3 weeks
**Risk Level**: CRITICAL - complex fusion logic

---

### Phase 4: RT Structures (Week 9-11)
**Goal**: Add RT structure support

12. **Create RT Provider**
    - [ ] `rt-structures/RTProvider.tsx` - 400 lines
    - RT state management
    - Structure loading

13. **Build RT components**
    - [ ] `rt-structures/components/RTOverlayLayer.tsx` - 500 lines
    - [ ] `rt-structures/components/RTControlPanel.tsx` - 300 lines
    - [ ] `rt-structures/services/ContourOperationsService.ts` - 800 lines

14. **Integrate into ViewerV2**
    - Plug RTOverlayLayer into PrimaryViewport
    - Test with RT structures

**Estimated Effort**: 2,000 lines, 3 weeks
**Risk Level**: HIGH - complex contour operations

---

### Phase 5: MPR & Advanced Features (Week 12-14)
**Goal**: Add MPR and advanced tools

15. **Build MPR support**
    - [ ] `components/viewer/MPRViewport.tsx` - 800 lines
    - [ ] Update `services/VolumeService.ts` - 500 lines

16. **Add measurement tools**
    - [ ] `components/viewer/MeasurementOverlay.tsx` - 300 lines

**Estimated Effort**: 1,600 lines, 3 weeks

---

### Phase 6: Testing & Refinement (Week 15-16)
**Goal**: Comprehensive testing

17. **Test suites**
    - Unit tests for all hooks
    - Integration tests for components
    - E2E tests for full workflows

18. **Bug fixes & refinements**

19. **Performance optimization**

**Estimated Effort**: 2 weeks

---

### Phase 7: Migration & Deprecation (Week 17-20)
**Goal**: Switch to new viewer as default

20. **Gradual rollout**
    - Week 17: New viewer opt-in via feature flag
    - Week 18: New viewer default, old available as fallback
    - Week 19: Monitor usage and fix regressions
    - Week 20: Deprecate old viewer

21. **Cleanup**
    - Remove old viewer files
    - Update documentation

**Estimated Effort**: 4 weeks

---

## Risk Assessment

### Critical Risks
1. **Fusion candidate resolution (400 lines)**: Complex graph traversal, FoR matching
2. **displayCurrentImage (300+ lines)**: Core rendering pipeline
3. **Contour operations (1,500+ lines)**: All RT editing logic
4. **Mouse interactions (900 lines)**: All viewport interactions

### Migration Strategy for Critical Functions

#### Strategy A: Parallel Implementation (Recommended)
- Build new version alongside old
- Test exhaustively before switching
- Keep old as fallback
- **Timeline**: 17-20 weeks
- **Risk**: Low (no disruption to working code)

#### Strategy B: Incremental Extraction
- Extract one function at a time
- Update both viewers to use extracted version
- Gradually reduce old viewer size
- **Timeline**: 12-15 weeks
- **Risk**: Medium (touching working code constantly)

#### Strategy C: Hybrid Approach
- Build new viewer shell
- Share extracted services/hooks with old viewer
- Gradually migrate features
- **Timeline**: 15-18 weeks
- **Risk**: Medium-Low

---

## Recommendation

**Use Strategy A (Parallel Implementation)** because:
1. Zero risk to existing working viewer
2. Can test thoroughly before switching
3. Allows for architectural improvements
4. Provides immediate fallback if issues arise
5. User requirement: "EVERYTHING MUST WORK EXACTLY LIKE IT WORKS NOW"

**Total Estimated Effort**:
- Lines of code to migrate: ~8,700
- New code to write: ~9,000 (includes hooks, services, improved structure)
- Timeline: 17-20 weeks for full migration
- Team size: 1 developer working full-time

---

## Success Criteria

### Functional Parity
- [ ] All CT viewing features work identically
- [ ] All fusion features work identically
- [ ] All RT structure features work identically
- [ ] All measurement tools work identically
- [ ] All keyboard shortcuts work identically
- [ ] Performance equal or better

### Code Quality
- [ ] No file exceeds 500 lines
- [ ] All functions have single responsibility
- [ ] TypeScript strict mode passes
- [ ] 80%+ test coverage
- [ ] All hooks properly documented

### Production Readiness
- [ ] 2+ weeks in production with zero critical bugs
- [ ] Error rate < 0.1%
- [ ] Load time <= existing viewer
- [ ] Memory usage <= existing viewer
- [ ] User acceptance by power users

---

## Appendix: Function Dependency Graph

```
ViewerInterface (root)
├── SeriesSelector
│   ├── useSeriesData
│   ├── shouldHideSeries
│   └── RTAutoLoader
├── PrimaryViewport
│   ├── useDICOMImages
│   ├── useViewportInteractions
│   ├── FusionOverlayLayer
│   │   ├── useFusionCandidates
│   │   ├── useRegistrationOptions
│   │   └── FusionOverlayManager
│   ├── RTOverlayLayer
│   │   ├── RTProvider
│   │   └── ContourOperationsService
│   └── MeasurementOverlay
├── ViewportControls
│   ├── useViewportTools
│   └── toolbar handlers
├── FusionPanel
│   ├── useFusionPanel
│   └── useRegistrationOptions
└── RTControlPanel
    ├── useRTStructures
    └── structure handlers
```

---

**Next Steps**: Review this mapping and confirm the approach before beginning implementation.

