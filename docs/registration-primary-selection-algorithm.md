# Registration Primary Selection Algorithm

## Problem Statement

The current registration relationship logic incorrectly assigns primaries based on simple heuristics:
- CT modality → always primary
- Shared Frame of Reference → create all pairwise relationships

This fails in real-world scenarios like PET/CT where:
- Derived "Fused CT" series share the same FOR as the PET
- The original planning CT has a different FOR
- The system creates hundreds of useless CT→CT relationships between derived outputs

## Correct Approach: Graph-Based Primary Detection

### Core Principles

1. **Registration relationships form a directed graph**
   - Nodes = series
   - Edges = registration transforms (from REG files or shared FOR)

2. **The primary is the ROOT of the registration tree**
   - Referenced by other series (incoming edges)
   - Doesn't reference other series (no outgoing edges)
   - All paths in the graph lead back to it

3. **Derived series are NEVER primaries**
   - They are outputs of fusion/registration processes
   - They share FOR with their secondary inputs, not the primary

### Algorithm Steps

#### Step 1: Identify Derived Series
Derived series should be EXCLUDED from primary consideration:
```
- Series description contains: "fused", "fusion", "derived", "registered"
- Series is output of a previous fusebox run (check fusebox_runs table)
- Series has high similarity in slice count to a known secondary (indicates resampled output)
```

#### Step 2: Parse REG Files for Explicit Relationships
REG DICOM files explicitly define which series registers to which:
```
- Parse Referenced Series Sequence
- Extract source → target relationships
- Build directed edges in graph
```

#### Step 3: Analyze Frame of Reference Clustering
Series with shared FOR may be:
- **Same acquisition session** (PET/CT scanner output)
- **Geometrically aligned** (pre-registered by scanner)

Key insight: **Series from the same acquisition session are PEERS, not primary/secondary**

Detection heuristics:
```
- Same FOR + Same acquisition date/time → peers from same session
- Same FOR + Different acquisition date → one is registered to the other
- Same FOR + One is derived → derived is output, not peer
```

#### Step 4: Build Registration Graph
```typescript
interface RegistrationNode {
  seriesId: number;
  modality: string;
  isDerived: boolean;
  frameOfReference: string;
  acquisitionDateTime: Date;
  imageCount: number;
}

interface RegistrationEdge {
  from: number;  // secondary series
  to: number;    // primary series
  method: 'REG-file' | 'shared-FOR' | 'implicit';
  confidence: number;
}

Graph:
  - Nodes: all non-derived imaging series (CT, MR, PT, CBCT)
  - Edges: directed from secondary → primary
```

#### Step 5: Find Graph Roots (Primary Candidates)
```typescript
function findPrimaryCandidates(graph: Graph): SeriesNode[] {
  // Nodes with ZERO outgoing edges (don't reference anything)
  const roots = graph.nodes.filter(node =>
    !node.isDerived &&
    graph.getOutgoingEdges(node).length === 0
  );

  return roots;
}
```

#### Step 6: Rank Primary Candidates
If multiple candidates exist, rank by:
```
1. Modality priority: CT > MR > PT > CBCT
2. Image count (higher = more likely to be planning)
3. Acquisition time (earlier = more likely to be planning)
4. Incoming edge count (more references = more likely primary)
```

## Example: PET/CT Study

### Input Data
```
Study 22 contains:
- Series 104: CT "Head_Neck C+" (153 images, FOR_A) - Planning CT
- Series 277,279: PT "Fused QCFX" (222 images, FOR_B) - PET from PET/CT scanner
- Series 185-301: CT "Fused CT STD" (222 images, FOR_B) - Derived CT from PET/CT scanner
- Series 105,106: REG files (reference FOR_A → FOR_B)
```

### Analysis

**Step 1: Identify Derived**
```
Series 185-301: DERIVED (contains "Fused" in description)
Series 277,279: NOT derived (original PET acquisition)
Series 104: NOT derived (original CT acquisition)
```

**Step 2: Parse REG Files**
```
REG 105,106: Source=FOR_A, Target=FOR_B
This means: FOR_A (planning CT) is the reference frame
```

**Step 3: Frame of Reference Clustering**
```
FOR_A: Series 104 (CT, 153 images) - ORIGINAL ACQUISITION
FOR_B: Series 277,279 (PT, 222 images) + Derived CTs (excluded)
       ↳ These are from SAME PET/CT session
```

**Step 4: Build Graph**
```
Nodes:
  - Node 104 (CT, FOR_A, original)
  - Node 277 (PT, FOR_B, original)
  - Node 279 (PT, FOR_B, original)

Edges:
  - 277 → 104 (via REG: FOR_B → FOR_A)
  - 279 → 104 (via REG: FOR_B → FOR_A)
```

**Step 5: Find Roots**
```
Node 104: Has 0 outgoing edges, 2 incoming edges → PRIMARY
Node 277: Has 1 outgoing edge → Secondary
Node 279: Has 1 outgoing edge → Secondary
```

**Step 6: Final Result**
```
✓ Primary: Series 104 (Planning CT, 153 images)
✓ Secondaries: Series 277, 279 (PET scans)
✓ Excluded: Series 185-301 (Derived fusion outputs)
```

## Implementation Requirements

### 1. Add Derived Series Detection
```sql
ALTER TABLE series ADD COLUMN is_derived BOOLEAN DEFAULT FALSE;
ALTER TABLE series ADD COLUMN derived_source_type TEXT; -- 'fusebox', 'scanner-fusion', etc
```

### 2. Update Registration Relationship Service
```typescript
// registration-relationship-service.ts

function identifyDerivedSeries(series: Series): boolean {
  const desc = series.seriesDescription?.toLowerCase() || '';
  const derivedKeywords = ['fused', 'fusion', 'derived', 'registered', 'resampled'];
  return derivedKeywords.some(kw => desc.includes(kw));
}

function buildRegistrationGraph(study: Study): RegistrationGraph {
  // Implementation of graph building
}

function selectPrimarySeries(graph: RegistrationGraph): Series[] {
  const roots = findGraphRoots(graph);
  return rankPrimaryCandidates(roots);
}
```

### 3. Create Correct Relationships
```typescript
// Only create relationships FROM secondaries TO primaries
// Never create relationships between derived series
// Never create relationships between peers from same acquisition
```

## Expected Outcome

For PET/CT Study 22:
- **1 primary**: Planning CT (Series 104)
- **2 secondaries**: PET scans (Series 277, 279)
- **2 relationships**: PT→CT, PT→CT
- **0 derived series** in relationship table

Current (incorrect): 630 relationships
Correct: **2 relationships**