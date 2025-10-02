# UI Integration Architecture

**Purpose**: Explain how UI components are organized and integrated in the new viewer architecture

**Date**: 2025-10-02

---

## 🏗️ Current Architecture Overview

### **Slot-Based Layout (ViewerShell)**

The new viewer uses a **slot-based architecture** where `ViewerV2` composes features into 4 main areas:

```
┌─────────────────────────────────────────┐
│           TOOLBAR (top)                 │  ← ViewportControls
├──────────┬──────────────────────────────┤
│          │                              │
│ SIDEBAR  │        VIEWPORT              │  ← PrimaryViewport
│ (left)   │        (center)              │     + Overlays
│          │                              │
│          │                              │
│          │                  ┌─────────┐ │
│          │                  │ PANELS  │ │  ← Floating panels
│          │                  │ (float) │ │     (right side)
└──────────┴──────────────────┴─────────┴─┘
```

**Code Structure** (`client/src/components/viewer/ViewerV2.tsx`):
```tsx
<ViewerShell
  toolbar={<ViewportControls />}           // Top: zoom, pan, tools
  sidebar={<SeriesSelector />}             // Left: series selection
  viewport={<PrimaryViewport />}           // Center: main canvas
  panels={<FloatingPanels />}              // Right: fusion + RT controls
/>
```

---

## 🎯 Design Philosophy

### **Principle: Feature Ownership**

Each feature agent owns its **complete vertical slice**:
- Service layer (operations)
- Overlay layer (rendering)
- Control panel (UI)

**Why?**
- ✅ Clear ownership boundaries
- ✅ Independent testing
- ✅ Easy to enable/disable features
- ✅ Parallel development

### **Integration Points**

1. **Rendering**: Overlays draw to shared `overlayCanvas`
2. **State**: Each feature has its own Context Provider
3. **UI**: Each feature provides its own control panel
4. **Composition**: `ViewerV2` assembles the pieces

---

## 📦 Current UI Components

### **Agent 1: Viewer Core**

**Owns**:
- ✅ `ViewerShell` - Layout wrapper (pure slots)
- ✅ `PrimaryViewport` - Main canvas
- ✅ `ViewportControls` - General toolbar (zoom, pan, measure)
- ✅ `useViewportTools` - Tool state management

**Location**: `client/src/components/viewer/`

**Responsibility**: Foundation - no feature-specific logic

---

### **Agent 2: Fusion**

**Owns**:
- ✅ `FusionOverlayLayer` - PET rendering
- ✅ `FusionPanel` - Fusion controls (exists but not integrated)
- ✅ `useFusionPanel` - Panel state
- ✅ `useFusionCandidates` - Series selection logic

**Location**: `client/src/fusion/components/`

**Current Integration** (ViewerV2.tsx):
```tsx
// ✅ Overlay integrated
<PrimaryViewport>
  <FusionOverlayLayer opacity={0.5} />
</PrimaryViewport>

// ❌ Panel NOT integrated (missing from ViewerV2)
// Should be in `panels` slot but isn't added yet
```

**What's Missing**:
- ❌ FusionPanel not added to ViewerV2's `panels` slot
- ❌ Fusion controls not accessible

---

### **Agent 3: RT Structures**

**Owns**:
- ✅ `RTOverlayLayer` - Contour rendering
- 🟡 `RTControlPanel` - Basic structure list
- ❌ `RTOperationsPanel` - **MISSING** (boolean, margins, grow)
- ❌ `RTDrawingToolbar` - **MISSING** (brush, pen, erase)

**Location**: `client/src/rt-structures/components/`

**Current Integration** (ViewerV2.tsx):
```tsx
// ✅ Overlay integrated
<PrimaryViewport>
  <RTOverlayLayer />
</PrimaryViewport>

// 🟡 Basic panel integrated
<div className="panels">
  <RTControlPanel />  {/* Only shows structure list */}
</div>

// ❌ Operation controls missing
// ❌ Drawing tools missing
```

**What's Missing**:
- ❌ Boolean operation controls (union/subtract/intersect buttons)
- ❌ Margin controls (input for margin distance)
- ❌ Grow/shrink controls
- ❌ Drawing tool mode selector (brush/pen/erase)
- ❌ Undo/redo buttons

---

## 🔀 Two Approaches to UI Organization

### **Approach 1: Distributed (Current Plan)** ✅ RECOMMENDED

**Structure**: Each feature owns its complete UI panel

```
client/src/
  ├── components/viewer/
  │   ├── ViewerShell.tsx        (Agent 1: Layout)
  │   ├── ViewportControls.tsx   (Agent 1: General tools)
  │   └── ViewerV2.tsx            (Agent 5: Composition)
  │
  ├── fusion/components/
  │   ├── FusionOverlayLayer.tsx (Agent 2: Rendering)
  │   └── FusionPanel.tsx         (Agent 2: Controls)
  │
  └── rt-structures/components/
      ├── RTOverlayLayer.tsx      (Agent 3: Rendering)
      ├── RTControlPanel.tsx      (Agent 3: Structure list)
      ├── RTOperationsPanel.tsx   (Agent 3: Boolean/margins)  ← MISSING
      └── RTDrawingToolbar.tsx    (Agent 3: Brush/pen/erase) ← MISSING
```

**Composition** (ViewerV2.tsx):
```tsx
<ViewerShell
  toolbar={<ViewportControls />}
  
  sidebar={<SeriesSelector />}
  
  viewport={
    <RTProvider>
      <PrimaryViewport>
        <FusionOverlayLayer />
        <RTOverlayLayer />
      </PrimaryViewport>
    </RTProvider>
  }
  
  panels={
    <PanelStack>
      <FusionPanel />              {/* Agent 2 */}
      <RTControlPanel />           {/* Agent 3 */}
      <RTOperationsPanel />        {/* Agent 3 - MISSING */}
      <RTDrawingToolbar />         {/* Agent 3 - MISSING */}
    </PanelStack>
  }
/>
```

**Pros**:
- ✅ Clear ownership
- ✅ Easy to test features independently
- ✅ Can hide/show panels based on active feature
- ✅ Parallel development (no conflicts)
- ✅ Easy to add new features (just add new panel)

**Cons**:
- ⚠️ Need coordination on panel layout (z-index, positioning)
- ⚠️ Could have duplicate UI patterns (buttons, inputs)

---

### **Approach 2: Centralized** ❌ NOT RECOMMENDED

**Structure**: Single "control center" that imports all operations

```
client/src/components/viewer/
  ├── ViewerShell.tsx
  ├── ViewportControls.tsx
  └── UnifiedControlPanel.tsx    ← Single panel for everything
      ├── FusionSection
      ├── RTStructureSection
      └── OperationsSection
```

**Composition**:
```tsx
<ViewerShell
  panels={
    <UnifiedControlPanel
      fusionState={fusionState}
      rtState={rtState}
      onBooleanOp={handleBoolean}
      onMarginOp={handleMargin}
      // ... 50+ props
    />
  }
/>
```

**Pros**:
- ✅ Consistent UI styling
- ✅ Single place to manage layout

**Cons**:
- ❌ Massive prop drilling
- ❌ Tight coupling between features
- ❌ Hard to test
- ❌ Single point of failure
- ❌ Merge conflicts during parallel development
- ❌ Can't easily disable features

---

## ✅ Recommended Architecture: Distributed with Shared Components

### **Best of Both Worlds**

**Principle**: Features own their panels, but share common UI components

```
client/src/
  ├── components/ui/              (Shared Tailwind/Shadcn components)
  │   ├── button.tsx
  │   ├── slider.tsx
  │   ├── input.tsx
  │   ├── card.tsx
  │   └── panel-container.tsx     ← Shared panel wrapper
  │
  ├── components/viewer/
  │   ├── ViewerShell.tsx
  │   ├── ViewportControls.tsx
  │   └── PanelStack.tsx          ← Helper for organizing panels
  │
  ├── fusion/components/
  │   └── FusionPanel.tsx         ← Uses shared UI components
  │
  └── rt-structures/components/
      ├── RTControlPanel.tsx      ← Uses shared UI components
      ├── RTOperationsPanel.tsx   ← Uses shared UI components
      └── RTDrawingToolbar.tsx    ← Uses shared UI components
```

**Shared Panel Container**:
```tsx
// client/src/components/ui/panel-container.tsx
export function PanelContainer({ 
  title, 
  minimizable = true,
  children 
}) {
  return (
    <Card className="bg-black/70 border border-gray-700 backdrop-blur-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
```

**Usage**:
```tsx
// fusion/components/FusionPanel.tsx
export function FusionPanel() {
  const fusion = useFusion();
  
  return (
    <PanelContainer title="Fusion Controls">
      <Slider 
        label="Opacity" 
        value={fusion.opacity}
        onChange={fusion.setOpacity}
      />
      {/* Fusion-specific controls */}
    </PanelContainer>
  );
}

// rt-structures/components/RTOperationsPanel.tsx
export function RTOperationsPanel() {
  const { rtStructures, operations } = useRT();
  
  return (
    <PanelContainer title="Contour Operations">
      <Button onClick={() => operations.union(...)}>Union</Button>
      <Button onClick={() => operations.subtract(...)}>Subtract</Button>
      <Input label="Margin (mm)" />
      {/* RT-specific controls */}
    </PanelContainer>
  );
}
```

**Benefits**:
- ✅ Consistent styling (shared components)
- ✅ Clear ownership (features own panels)
- ✅ Easy to test (panels are independent)
- ✅ No prop drilling (each panel uses its own context)

---

## 🎨 Panel Organization Strategy

### **Layout Management**

**Option A: Stacked Panels (Current)**
```tsx
<div className="absolute bottom-4 right-4 space-y-2">
  <FusionPanel />
  <RTControlPanel />
  <RTOperationsPanel />
</div>
```

**Pros**: Simple, always visible  
**Cons**: Takes up space, could overlap

---

**Option B: Tabbed Interface**
```tsx
<Tabs defaultValue="fusion">
  <TabsList>
    <TabsTrigger value="fusion">Fusion</TabsTrigger>
    <TabsTrigger value="rt">RT Structures</TabsTrigger>
  </TabsList>
  <TabsContent value="fusion"><FusionPanel /></TabsContent>
  <TabsContent value="rt">
    <RTControlPanel />
    <RTOperationsPanel />
  </TabsContent>
</Tabs>
```

**Pros**: Saves space, organized  
**Cons**: Can only see one at a time

---

**Option C: Collapsible Sidebar** ✅ RECOMMENDED
```tsx
<ViewerShell
  sidebar={
    <Accordion>
      <AccordionItem title="Series">
        <SeriesSelector />
      </AccordionItem>
      <AccordionItem title="Fusion">
        <FusionPanel />
      </AccordionItem>
      <AccordionItem title="RT Structures">
        <RTControlPanel />
        <RTOperationsPanel />
      </AccordionItem>
    </Accordion>
  }
  
  panels={
    {/* Floating panels only for active tools */}
    {isDrawing && <RTDrawingToolbar />}
  }
/>
```

**Pros**: 
- ✅ Organized, always accessible
- ✅ Saves space (collapse sections)
- ✅ Floating panels only for active tools

**Cons**: 
- ⚠️ Requires accordion component

---

## 🚧 Current State & Gaps

### **What's Integrated** ✅

1. **Agent 1 (Core)**
   - ✅ ViewerShell layout
   - ✅ PrimaryViewport rendering
   - ✅ ViewportControls toolbar

2. **Agent 2 (Fusion)**
   - ✅ FusionOverlayLayer rendering
   - ❌ FusionPanel **NOT** added to ViewerV2

3. **Agent 3 (RT)**
   - ✅ RTOverlayLayer rendering
   - ✅ RTControlPanel (basic structure list)
   - ❌ RTOperationsPanel missing
   - ❌ RTDrawingToolbar missing

### **Integration Gaps** 🔴

#### **Gap 1: FusionPanel Not Integrated**

**Current** (ViewerV2.tsx line 78-89):
```tsx
panels={
  <div className="absolute bottom-4 right-4 space-y-2">
    <div className="bg-gray-900/90">...</div>  {/* Debug info */}
    <div className="bg-black/70">
      <RTControlPanel />                       {/* Only RT panel */}
    </div>
  </div>
}
```

**Should Be**:
```tsx
panels={
  <div className="absolute bottom-4 right-4 space-y-2">
    <FusionPanel />          {/* ADD THIS */}
    <RTControlPanel />
    <RTOperationsPanel />    {/* ADD THIS */}
  </div>
}
```

**Who Fixes**: Agent 5 (Integration)

---

#### **Gap 2: RT Operation Controls Missing**

**Current**: `RTControlPanel` only shows structure list (selection/visibility)

**Missing**: `RTOperationsPanel` with:
- Boolean operation buttons (Union, Subtract, Intersect)
- Margin controls (input field, apply button)
- Grow/shrink controls
- Preview toggle
- Undo/redo buttons

**Who Fixes**: Agent 3

**Estimated**: ~150 lines, ~4 hours

---

#### **Gap 3: Drawing Tools Missing**

**Missing**: `RTDrawingToolbar` with:
- Tool mode selector (brush/pen/erase)
- Brush size slider
- Drawing controls (clear, undo, apply)

**Who Fixes**: Agent 3

**Estimated**: ~100 lines, ~3 hours

---

## 📋 Action Plan

### **Phase 1: Complete RT UI** (Agent 3) - 7 hours

1. **Create RTOperationsPanel.tsx** (~150 lines)
   ```tsx
   export function RTOperationsPanel() {
     const { 
       rtStructures, 
       selection, 
       operations,
       undoRedo 
     } = useRT();
     
     return (
       <PanelContainer title="Operations">
         <div className="space-y-2">
           <h4>Boolean Operations</h4>
           <Button onClick={handleUnion}>Union</Button>
           <Button onClick={handleSubtract}>Subtract</Button>
           <Button onClick={handleIntersect}>Intersect</Button>
           
           <h4>Margins</h4>
           <Input 
             label="Distance (mm)" 
             value={marginDistance}
             onChange={setMarginDistance}
           />
           <Button onClick={handleApplyMargin}>Apply</Button>
           
           <h4>History</h4>
           <Button onClick={undoRedo.undo}>Undo</Button>
           <Button onClick={undoRedo.redo}>Redo</Button>
         </div>
       </PanelContainer>
     );
   }
   ```

2. **Create RTDrawingToolbar.tsx** (~100 lines)
   ```tsx
   export function RTDrawingToolbar() {
     const [tool, setTool] = useState<'brush' | 'pen' | 'erase'>('brush');
     const [brushSize, setBrushSize] = useState(5);
     
     return (
       <div className="absolute top-4 left-1/2 -translate-x-1/2">
         <Card>
           <ToggleGroup value={tool} onValueChange={setTool}>
             <ToggleButton value="brush">Brush</ToggleButton>
             <ToggleButton value="pen">Pen</ToggleButton>
             <ToggleButton value="erase">Erase</ToggleButton>
           </ToggleGroup>
           
           {tool === 'brush' && (
             <Slider 
               label="Size" 
               value={brushSize}
               onChange={setBrushSize}
             />
           )}
         </Card>
       </div>
     );
   }
   ```

3. **Wire up to RTProvider** (~50 lines)
   - Add operation handlers to RTProvider context
   - Connect UI actions to ContourOperationsService

---

### **Phase 2: Integrate All Panels** (Agent 5) - 3 hours

1. **Add FusionPanel to ViewerV2**
   ```tsx
   import { FusionPanel } from '@/fusion/components/FusionPanel';
   
   <ViewerShell
     panels={
       <div className="absolute bottom-4 right-4 space-y-2">
         <FusionPanel />               {/* ADD */}
         <RTControlPanel />
         <RTOperationsPanel />         {/* ADD */}
       </div>
     }
   />
   ```

2. **Add conditional drawing toolbar**
   ```tsx
   const { isDrawing } = useViewportTools();
   
   {isDrawing && <RTDrawingToolbar />}
   ```

3. **Test integration**
   - All panels render correctly
   - No z-index conflicts
   - Responsive layout works

---

### **Phase 3: Polish** (Agent 5) - 4 hours

1. **Create PanelStack component** for better layout management
2. **Add accordion/collapsible sections**
3. **Add keyboard shortcuts**
4. **Add tooltips and help text**

---

## 🎯 Recommendations

### **For Agent 3** 🔴 HIGH PRIORITY

1. **Create `RTOperationsPanel`** - Expose boolean/margin operations
2. **Create `RTDrawingToolbar`** - Tool mode selector
3. **Wire operations to UI** - Connect buttons to ContourOperationsService
4. **Add progress indicators** - Show "Processing..." during operations

**Deliverable**: Two new components (~250 lines total)

---

### **For Agent 5** 🟡 MEDIUM PRIORITY

1. **Integrate FusionPanel** - Add to ViewerV2's panels slot
2. **Integrate RT panels** - Add RTOperationsPanel to ViewerV2
3. **Create PanelStack** - Helper for organizing floating panels
4. **Test layout** - Ensure no conflicts, responsive design works

**Deliverable**: Updated ViewerV2 with all panels integrated

---

### **For Future** 🟢 LOW PRIORITY

1. **Create collapsible sidebar** - Move panels to sidebar with accordion
2. **Add tabbed interface** - Alternative layout for smaller screens
3. **Panel persistence** - Remember collapsed/expanded state
4. **Custom panel positioning** - Let users drag panels around

---

## 📊 Summary

### **Should UI Be Split Up?**

**Answer**: ✅ **YES - Split by Feature**

- Each feature owns its complete UI panel
- Use shared components for consistency
- ViewerV2 composes panels via slots
- Clear boundaries, easy testing, parallel development

### **Current Status**

| Component | Owner | Status | Location |
|-----------|-------|--------|----------|
| ViewerShell | Agent 1 | ✅ Done | `components/viewer/` |
| ViewportControls | Agent 1 | ✅ Done | `components/viewer/` |
| FusionOverlayLayer | Agent 2 | ✅ Done | `fusion/components/` |
| FusionPanel | Agent 2 | ✅ Exists | `fusion/components/` |
| - Integration | Agent 5 | ❌ Missing | `ViewerV2.tsx` |
| RTOverlayLayer | Agent 3 | ✅ Done | `rt-structures/components/` |
| RTControlPanel | Agent 3 | 🟡 Basic | `rt-structures/components/` |
| RTOperationsPanel | Agent 3 | ❌ Missing | `rt-structures/components/` |
| RTDrawingToolbar | Agent 3 | ❌ Missing | `rt-structures/components/` |

### **Next Steps**

1. **Agent 3**: Create RT operation panels (~250 lines, 7 hours)
2. **Agent 5**: Integrate all panels into ViewerV2 (3 hours)
3. **Testing**: Verify layout, interactions, responsiveness (4 hours)

**Total Remaining**: ~14 hours to complete UI integration

---

**Last Updated**: 2025-10-02  
**Status**: Architecture defined, partially implemented

