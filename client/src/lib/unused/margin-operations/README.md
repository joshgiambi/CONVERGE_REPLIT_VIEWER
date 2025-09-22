# Unused Margin Operations

These margin operation files were moved here because they have zero imports and zero runtime usage in the codebase.

## Files moved:
- volumetric-margin-operations.ts - Superseded by volumetric-margin-operations-optimized.ts
- proper-morphological-margins.ts - Experimental implementation, never used
- contour-margin-operations.ts - Legacy interface, replaced by enhanced-margin-operations.ts
- simple-3d-radial-expansion.ts - Experimental implementation, never used
- simple-margin-preview.ts - Preview-specific code, likely dead code

## Analysis Date: Sun Sep 21 09:31:41 CST 2025

## How to restore:
If any of these files are needed, move them back to client/src/lib/ and update imports.

## Active margin operations (DO NOT MOVE):
- fast-3d-margin-operations.ts (PRIMARY - 3 direct imports)
- volumetric-margin-operations-optimized.ts (SECONDARY - 1 import)
- simple-polygon-operations.ts (FALLBACK - used by fast-3d)
- enhanced-margin-operations.ts (ORCHESTRATOR - coordinates algorithms)
- anisotropic-margin-operations.ts (SPECIALIZED - anisotropic margins)
- morphological-margin-operations.ts (DEPENDENCY - used by enhanced)
- true-3d-margin-operations.ts (DEPENDENCY - used by enhanced)

