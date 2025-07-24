# Advanced Pen Tool Specification

## Overview
The advanced pen tool combines continuous drawing capabilities with intelligent boolean operations based on the starting position relative to existing contours. It supports both discrete point placement and continuous line drawing with automatic shape completion.

## Core Drawing Behaviors

### 1. Continuous Drawing Mode
- **Left Click + Drag**: Creates continuous freehand lines
- **Left Click (discrete)**: Places individual vertices
- **Mixed Mode**: Can alternate between click-and-drag and discrete clicks
  - Release left button → continues with straight line from last point
  - Left click again → places new vertex
  - Left click + hold → resumes continuous drawing

### 2. Initial Point Behavior
- First vertex has a **larger hit area** (15-20 pixel radius)
- Makes it easier to close shapes by clicking near the starting point
- Visual feedback when cursor is within closing range

### 3. Right-Click Auto-Complete
- **Right click at any time** automatically closes the shape:
  - Adds a vertex at the current cursor position
  - Draws line from last vertex to this new point
  - Closes path back to first vertex
  - Completes the shape operation
- **Right button hold + drag**: Allows continuous drawing with right button

## Boolean Operations

### Context-Sensitive Operations
The tool automatically determines whether to ADD or SUBTRACT based on the starting position:

1. **SUBTRACT Mode** (Automatic)
   - Triggered when drawing starts **OUTSIDE** an existing contour
   - AND the drawn shape intersects with the existing contour
   - Result: Removes the intersection area from the existing contour

2. **ADD Mode** (Automatic)
   - Triggered when drawing starts **INSIDE** an existing contour
   - Result: Adds the drawn area to the existing contour

### Visual Flow Examples
```
Starting Outside → Draw into contour → Complete = SUBTRACT
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Existing  │     │   Draw from │     │   Result:   │
│  ┌─────┐    │ --> │  outside    │ --> │  ┌──┐  ┌──┐ │
│  │     │    │     │  ──┐  ┌──   │     │  │  │  │  │ │
│  └─────┘    │     │    └──┘     │     │  └──┘  └──┘ │
└─────────────┘     └─────────────┘     └─────────────┘

Starting Inside → Draw within → Complete = ADD
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Existing  │     │   Draw from │     │   Result:   │
│  ┌─────┐    │ --> │  inside     │ --> │  ┌───────┐  │
│  │  •  │    │     │  ┌─•──┐     │     │  │       │  │
│  └─────┘    │     │  └────┘     │     │  └───────┘  │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Interactive Editing Features

### 1. Contour Highlighting
- When cursor approaches existing contour border (within 10 pixels)
- Entire contour or segment **highlights** with visual feedback
- Indicates the contour is ready for interaction

### 2. Vertex Dragging
- **Hover near vertex**: Cursor changes to grab/hand icon
- **Click and drag vertex**: 
  - Selected vertex follows cursor
  - **Nearby vertices move proportionally** based on distance
  - Creates smooth deformation rather than sharp angles
  - Real-time preview during drag

### 3. Smart Deformation
When dragging a vertex:
- Vertices within the "influence radius" move partially
- Movement falloff based on distance from dragged vertex
- Maintains contour smoothness

## Implementation Logic

### State Machine
```javascript
States:
- IDLE: Tool active, awaiting input
- DRAWING_DISCRETE: Placing individual vertices
- DRAWING_CONTINUOUS: Continuous line mode (mouse down)
- NEAR_CLOSE: Cursor near first vertex (larger hit area)
- DRAGGING_VERTEX: Editing existing vertex
- PREVIEW: Shape complete, awaiting confirmation

Transitions:
- Left Click → Check if near vertex/contour
  - If near vertex → DRAGGING_VERTEX
  - If near first vertex → Close shape
  - Otherwise → Add vertex, enter DRAWING mode
- Left Drag → DRAWING_CONTINUOUS
- Right Click → Auto-complete shape
- Mouse Move → Update preview, check proximities
```

### Key Functions

#### 1. Starting Position Detection
```javascript
function getDrawingContext(startPoint) {
  const nearestContour = findNearestContour(startPoint);
  if (isPointInsideContour(startPoint, nearestContour)) {
    return { mode: 'ADD', targetContour: nearestContour };
  } else {
    return { mode: 'SUBTRACT', targetContour: null };
  }
}
```

#### 2. Auto-Complete on Right Click
```javascript
function autoCompleteShape(currentVertices, mousePosition) {
  // Add vertex at current mouse position
  vertices.push(mousePosition);
  // Close back to first vertex
  vertices.push(vertices[0]);
  // Apply boolean operation based on context
  applyBooleanOperation(vertices, drawingContext);
}
```

#### 3. Vertex Influence Dragging
```javascript
function dragVertexWithInfluence(draggedIndex, newPosition, influenceRadius) {
  const dragDelta = subtract(newPosition, vertices[draggedIndex]);
  
  vertices.forEach((vertex, index) => {
    if (index === draggedIndex) {
      vertex = newPosition;
    } else {
      const distance = getDistance(vertex, vertices[draggedIndex]);
      if (distance < influenceRadius) {
        const influence = 1 - (distance / influenceRadius);
        vertex = add(vertex, scale(dragDelta, influence * 0.5));
      }
    }
  });
}
```

## Visual Feedback Requirements

### Cursor States
1. **Default**: Crosshair cursor
2. **Near First Vertex**: Larger circle indicator (closing range)
3. **Near Existing Vertex**: Hand/grab cursor
4. **Dragging**: Closed hand cursor
5. **Drawing**: Pen cursor

### Line Rendering
1. **Active Drawing**: Structure color with 2px width
2. **Preview Line**: Dashed line from last vertex to cursor
3. **Near Close**: First vertex highlighted with larger radius
4. **Boolean Preview**: 
   - ADD mode: Green overlay on preview area
   - SUBTRACT mode: Red striped overlay on preview area

### Contour Highlighting
1. **Hover Effect**: 
   - Contour border thickens (3-4px)
   - Slight glow effect in structure color
   - Semi-transparent fill overlay

## User Workflow

### Basic Drawing
1. Select structure to edit
2. Click pen tool
3. Click or drag to draw shape
4. Right-click to auto-complete OR click near first vertex

### Editing Existing Contours
1. Hover near contour to highlight
2. Click and drag vertex to deform
3. Nearby vertices move smoothly with influence

### Boolean Operations (Automatic)
1. Start drawing outside → creates subtraction
2. Start drawing inside → creates addition
3. No mode selection needed - context-aware

## Performance Considerations

1. **Continuous Drawing**: Sample points at reasonable intervals (5-10 pixels)
2. **Vertex Influence**: Limit influence radius to maintain performance
3. **Real-time Preview**: Use requestAnimationFrame for smooth updates
4. **Boolean Operations**: Optimize polygon intersection algorithms

## Keyboard Shortcuts

- **Escape**: Cancel current drawing
- **Enter**: Complete shape (alternative to right-click)
- **Shift**: Toggle between add/subtract (override automatic)
- **Ctrl+Z**: Undo last operation
- **Delete**: Remove selected vertex (in edit mode)