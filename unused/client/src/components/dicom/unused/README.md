# Unused Margin Tools

This folder contains the old margin operation tools that have been replaced by the new **Advanced Margin Tool**.

## Files Moved Here

### `grow-margin-toolbar.tsx`
- Simple grow/shrink toolbar with basic uniform operations
- Used simple distance input (cm converted to mm)
- Limited to uniform expansion/contraction

### `margin-operation-panel.tsx`
- More advanced panel with uniform/asymmetric/custom margin types
- Had preview functionality but limited algorithm options
- Used for directional margins but not fully integrated

### `simple-grow-operations.tsx`
- Basic grow/shrink operations component
- Used simple buffering algorithms
- Had preview but limited to simple operations

## Replacement

All these tools have been replaced by the **Advanced Margin Tool** (`advanced-margin-tool.tsx`) which provides:

- **Sophisticated algorithms**: Morphological operations, directional growth, surface-based
- **Mathematical precision**: Dilation/erosion with spherical kernels
- **Advanced preview**: Real-time dashed line previews with opacity controls
- **Algorithm selection**: Automatic fallback from morphological → directional → simple
- **Enhanced parameters**: Smoothing, corner handling, resolution control
- **3D operations**: Works on entire structures across all slices

## Restoration

If you need to restore any of these tools:

1. Move the desired file back to `client/src/components/dicom/`
2. Add the appropriate imports back to the viewer interface
3. Add the toolbar button back to the viewer toolbar
4. Update the interface props and handlers

## Legacy References Removed

- All imports and references removed from `viewer-interface.tsx`
- Old margin button removed from `viewer-toolbar.tsx`
- ContourEditToolbar updated to redirect to Advanced Margin Tool
- State management cleaned up (removed `showGrowMarginOperations`)

The new Advanced Margin Tool provides all the functionality of these old tools plus much more sophisticated mathematical operations and better user experience. 