# Superbeam UI Branding & Style Guide
## Complete UI Documentation for OHIF Migration

This document provides comprehensive branding, styling, and UI component specifications for the Superbeam DICOM medical imaging platform, suitable for migration to OHIF or other medical imaging platforms.

---

## 1. Brand Identity & Color Scheme

### Primary Brand Colors
```css
/* Core Brand Colors */
:root {
  /* DICOM Standard Colors */
  --dicom-black: 0 0% 0%; /* #000000 */
  --dicom-dark: 240 20% 8%; /* #0f0f19 */
  --dicom-darker: 245 25% 12%; /* #1a1a32 */
  
  /* Brand Gradient Colors */
  --dicom-indigo: 240 100% 60%; /* #6366F1 */
  --dicom-purple: 270 100% 70%; /* #A855F7 */
  --dicom-purple-dark: 280 100% 50%; /* #9333EA */
  --dicom-purple-light: 260 100% 80%; /* #C084FC */
  
  /* Gradient Definitions */
  --dicom-gradient-primary: linear-gradient(135deg, hsl(240 100% 60%), hsl(270 100% 70%));
  --dicom-gradient-secondary: linear-gradient(135deg, hsl(280 100% 50%), hsl(240 100% 60%));
  --dicom-gradient-subtle: linear-gradient(135deg, hsla(240 100% 60% / 0.1), hsla(270 100% 70% / 0.1));
  
  /* Functional Colors */
  --dicom-gray: 240 15% 25%; /* #404040 */
  --dicom-gray-light: 240 10% 38%; /* #606060 */
  --dicom-gray-lighter: 240 5% 50%; /* #808080 */
  
  /* Medical Interface Colors */
  --dicom-yellow: 51 100% 50%; /* #FFD700 - highlight/selection */
  --medical-green: 120 100% 40%; /* #00CC00 - RT structures */
  --medical-blue: 210 100% 60%; /* #3399FF - visibility toggle */
  --medical-red: 0 84% 60%; /* #F56565 - delete/destructive */
  --medical-orange: 25 100% 60%; /* #FF8000 - operations */
}
```

### Superbeam Logo Styling
```css
/* Superbeam Logo Typography */
.superbeam-logo {
  font-family: 'Inter', sans-serif;
  font-weight: 900;
  font-size: 1.25rem; /* 20px */
  letter-spacing: 0.25em;
  display: flex;
  align-items: center;
}

.superbeam-logo .letter-super {
  color: white;
  font-weight: 900;
}

.superbeam-logo .letter-beam {
  background: linear-gradient(45deg, #9333ea, #dc2626);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-weight: 900;
}

/* Alternative compact version */
.superbeam-logo-compact {
  font-size: 1rem;
  letter-spacing: 0.1em;
}
```

---

## 2. Header & Navigation System

### Main Application Header
```css
/* Fixed Header Styling */
.superbeam-header {
  position: fixed;
  top: 1rem;
  left: 1rem;
  right: 1rem;
  background: rgba(15, 15, 25, 0.8); /* dicom-dark with opacity */
  backdrop-filter: blur(12px);
  border: 1px solid rgba(103, 102, 241, 0.3); /* dicom-indigo with opacity */
  border-radius: 1rem;
  padding: 0.75rem 1.5rem;
  z-index: 50;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  animation: slide-up 0.3s ease-out;
}

.superbeam-header.enhanced-viewer {
  border-color: rgba(34, 197, 94, 0.3); /* green accent for enhanced viewer */
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Header Content Layout */
.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-patient-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-left: 1rem;
  border-left: 1px solid #4b5563;
}

.patient-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: hsl(var(--dicom-yellow));
}

.study-info {
  font-size: 0.75rem;
  color: #9ca3af;
}
```

---

## 3. Left Sidebar System

### Sidebar Container & Layout
```css
/* Main Sidebar Structure */
.medical-sidebar {
  position: fixed;
  left: 0;
  top: 0;
  width: 400px;
  height: 100vh;
  background: hsl(var(--dicom-black));
  border-right: 1px solid hsl(var(--dicom-gray));
  display: flex;
  flex-direction: column;
  z-index: 40;
  overflow: hidden;
}

/* Sidebar Header */
.sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem;
  border-bottom: 1px solid hsl(var(--dicom-gray));
}

/* Sidebar Tab System */
.sidebar-tabs {
  display: flex;
  background: hsl(var(--dicom-darker));
  border-radius: 0.5rem;
  padding: 0.25rem;
}

.sidebar-tab {
  flex: 1;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: center;
  border-radius: 0.375rem;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sidebar-tab.active {
  background: hsl(var(--dicom-indigo));
  color: white;
}

.sidebar-tab:hover:not(.active) {
  background: rgba(99, 102, 241, 0.1);
  color: white;
}

/* Sidebar Content */
.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

/* Custom Scrollbar */
.sidebar-content::-webkit-scrollbar {
  width: 8px;
}

.sidebar-content::-webkit-scrollbar-track {
  background: hsl(var(--dicom-dark));
}

.sidebar-content::-webkit-scrollbar-thumb {
  background: hsl(var(--dicom-gray));
  border-radius: 4px;
}

.sidebar-content::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--dicom-gray-light));
}
```

### Series Selection UI
```css
/* Series List Styling */
.series-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.series-item {
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  background: hsl(var(--dicom-dark));
  border: 1px solid hsl(var(--dicom-gray));
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.series-item:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: hsl(var(--dicom-indigo));
}

.series-item.selected {
  background: rgba(99, 102, 241, 0.2);
  border-color: hsl(var(--dicom-indigo));
}

.series-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.series-modality {
  background: hsl(var(--dicom-indigo));
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.series-count {
  font-size: 0.75rem;
  color: #9ca3af;
}

.series-description {
  font-size: 0.875rem;
  color: white;
  font-weight: 500;
}

/* RT Structure Nesting */
.rt-series-nested {
  margin-left: 0.5rem;
  margin-top: 0.25rem;
  padding-left: 0.5rem;
  border-left: 2px solid rgba(34, 197, 94, 0.3);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.rt-series-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 0.5rem;
  font-size: 0.75rem;
  color: #d1d5db;
  cursor: pointer;
  transition: all 0.2s ease;
}

.rt-series-item:hover {
  background: rgba(34, 197, 94, 0.2);
}

.rt-series-item.selected {
  background: #16a34a;
  color: white;
  border-color: #16a34a;
}

.rt-badge {
  background: #16a34a;
  color: white;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.625rem;
  font-weight: 700;
}
```

---

## 4. RT Structure Management UI

### Structure List Header Controls
```css
/* Control Button Row */
.structure-controls {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.structure-control-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid;
  min-width: 2.5rem;
  height: 2.5rem;
}

/* Show/Hide All Button */
.btn-visibility-toggle {
  background: rgba(34, 197, 94, 0.8);
  border-color: #16a34a;
  color: white;
}

.btn-visibility-toggle:hover {
  background: #16a34a;
}

/* Grouping Toggle Button */
.btn-grouping-toggle {
  background: rgba(0, 0, 0, 0.2);
  border-color: #4b5563;
  color: #d1d5db;
}

.btn-grouping-toggle:hover {
  background: #374151;
}

/* Expand/Collapse Button */
.btn-expand-toggle {
  background: rgba(234, 179, 8, 0.8);
  border-color: #eab308;
  color: white;
}

.btn-expand-toggle:hover {
  background: #eab308;
}

/* Add Contour Button */
.btn-add-contour {
  background: rgba(37, 99, 235, 0.8);
  border-color: #2563eb;
  color: white;
}

.btn-add-contour:hover {
  background: #2563eb;
}

/* Operations Button */
.btn-operations {
  background: rgba(251, 146, 60, 0.8);
  border-color: #f97316;
  color: white;
}

.btn-operations:hover {
  background: #f97316;
}

/* Settings Button */
.btn-settings {
  background: rgba(168, 85, 247, 0.8);
  border-color: #a855f7;
  color: white;
}

.btn-settings:hover {
  background: #a855f7;
}
```

### Structure List Items
```css
/* Search Input */
.structure-search {
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: hsl(var(--dicom-dark));
  border: 1px solid hsl(var(--dicom-gray));
  border-radius: 0.375rem;
  color: white;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.structure-search:focus {
  outline: none;
  border-color: hsl(var(--dicom-indigo));
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

.structure-search::placeholder {
  color: #9ca3af;
}

/* Structure Groups (when grouped) */
.structure-group {
  margin-bottom: 0.75rem;
}

.structure-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 0.375rem;
  cursor: pointer;
  margin-bottom: 0.25rem;
}

.structure-group-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.structure-group-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
}

.structure-group-count {
  background: rgba(99, 102, 241, 0.8);
  color: white;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.structure-group-colors {
  display: flex;
  gap: 0.125rem;
}

.structure-group-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

/* Individual Structure Items */
.structure-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: hsl(var(--dicom-dark));
  border: 1px solid hsl(var(--dicom-gray));
  border-radius: 0.375rem;
  margin-bottom: 0.25rem;
  transition: all 0.2s ease;
}

.structure-item:hover {
  background: rgba(99, 102, 241, 0.05);
  border-color: rgba(99, 102, 241, 0.3);
}

.structure-item.selected {
  background: rgba(234, 179, 8, 0.1);
  border-color: rgba(234, 179, 8, 0.5);
}

.structure-item.editing {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.5);
}

/* Structure Item Components */
.structure-checkbox {
  width: 1rem;
  height: 1rem;
  border: 2px solid #4b5563;
  border-radius: 0.25rem;
  background: transparent;
  cursor: pointer;
  position: relative;
}

.structure-checkbox.checked {
  background: #eab308;
  border-color: #eab308;
}

.structure-checkbox.checked::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: black;
  font-size: 0.75rem;
  font-weight: bold;
}

.structure-color-indicator {
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
}

.structure-name {
  flex: 1;
  font-size: 0.875rem;
  color: white;
  font-weight: 500;
}

.structure-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.structure-action-btn {
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

/* Visibility Toggle */
.btn-visibility {
  background: rgba(59, 130, 246, 0.8);
  color: white;
}

.btn-visibility:hover {
  background: #3b82f6;
}

.btn-visibility.hidden {
  background: rgba(107, 114, 128, 0.5);
  color: #9ca3af;
}

/* Edit Button */
.btn-edit {
  background: rgba(34, 197, 94, 0.8);
  color: white;
}

.btn-edit:hover {
  background: #22c55e;
}

.btn-edit.active {
  background: #16a34a;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3);
}

/* Delete Button */
.btn-delete {
  background: rgba(239, 68, 68, 0.8);
  color: white;
}

.btn-delete:hover {
  background: #ef4444;
}
```

---

## 5. Bottom Contour Editing Toolbar

### Main Toolbar Container
```css
/* Contour Edit Toolbar */
.contour-toolbar {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  background: hsl(var(--dicom-black));
  border: 2px solid hsl(var(--dicom-gray));
  border-radius: 0.75rem;
  padding: 0.75rem;
  gap: 0.5rem;
  z-index: 45;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
}

/* Dynamic border color based on selected structure */
.contour-toolbar[data-structure-color] {
  border-color: var(--structure-color);
  box-shadow: 0 0 0 1px var(--structure-color-muted), 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

/* Main Tool Buttons */
.contour-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  border-radius: 0.5rem;
  background: hsl(var(--dicom-dark));
  border: 2px solid hsl(var(--dicom-gray));
  color: #d1d5db;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.contour-tool-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: white;
}

.contour-tool-btn.active {
  background: rgba(var(--structure-color-rgb), 0.2);
  border-color: var(--structure-color);
  color: white;
  box-shadow: 0 0 12px rgba(var(--structure-color-rgb), 0.4);
}

/* Tool Icons */
.contour-tool-btn svg {
  width: 1.25rem;
  height: 1.25rem;
}

/* Settings Expansion Indicator */
.contour-tool-btn .expand-indicator {
  position: absolute;
  top: -0.25rem;
  right: -0.25rem;
  width: 0.75rem;
  height: 0.75rem;
  background: var(--structure-color);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.5rem;
  color: white;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.contour-tool-btn:hover .expand-indicator {
  opacity: 1;
}
```

### Expandable Settings Panels
```css
/* Settings Panel Container */
.contour-settings-panel {
  position: absolute;
  bottom: 100%;
  margin-bottom: 0.5rem;
  background: hsl(var(--dicom-black));
  border: 2px solid var(--structure-color-muted);
  border-radius: 0.75rem;
  padding: 1rem;
  min-width: 280px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(12px);
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s ease;
  pointer-events: none;
}

.contour-settings-panel.open {
  opacity: 1;
  transform: translateY(0);
  pointer-events: all;
}

/* Settings Panel Header */
.settings-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid hsl(var(--dicom-gray));
}

.settings-panel-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
}

.settings-panel-close {
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s ease;
}

.settings-panel-close:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* Settings Controls */
.settings-group {
  margin-bottom: 1rem;
}

.settings-group:last-child {
  margin-bottom: 0;
}

.settings-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: #d1d5db;
  margin-bottom: 0.5rem;
}

/* Brush Thickness Slider */
.brush-thickness-slider {
  width: 100%;
  height: 0.5rem;
  background: hsl(var(--dicom-gray));
  border-radius: 0.25rem;
  appearance: none;
  cursor: pointer;
}

.brush-thickness-slider::-webkit-slider-thumb {
  appearance: none;
  width: 1rem;
  height: 1rem;
  background: var(--structure-color);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(var(--structure-color-rgb), 0.4);
}

.brush-thickness-slider::-moz-range-thumb {
  width: 1rem;
  height: 1rem;
  background: var(--structure-color);
  border-radius: 50%;
  cursor: pointer;
  border: none;
  box-shadow: 0 0 8px rgba(var(--structure-color-rgb), 0.4);
}

/* Toggle Switches */
.settings-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.toggle-switch {
  position: relative;
  width: 2.5rem;
  height: 1.25rem;
  background: hsl(var(--dicom-gray));
  border-radius: 0.625rem;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.toggle-switch.checked {
  background: var(--structure-color);
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 0.125rem;
  left: 0.125rem;
  width: 1rem;
  height: 1rem;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s ease;
}

.toggle-switch.checked::after {
  transform: translateX(1.25rem);
}

/* Delete Operations Panel */
.delete-operations-panel {
  border-color: rgba(239, 68, 68, 0.5);
}

.delete-btn {
  width: 100%;
  padding: 0.5rem 1rem;
  background: rgba(239, 68, 68, 0.8);
  border: 1px solid #ef4444;
  border-radius: 0.375rem;
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 0.5rem;
}

.delete-btn:hover {
  background: #ef4444;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

.delete-btn:last-child {
  margin-bottom: 0;
}

/* Slice Input for "Delete Nth Slice" */
.slice-input-group {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.slice-number-input {
  flex: 1;
  padding: 0.375rem 0.5rem;
  background: hsl(var(--dicom-dark));
  border: 1px solid hsl(var(--dicom-gray));
  border-radius: 0.25rem;
  color: white;
  font-size: 0.875rem;
}

.slice-number-input:focus {
  outline: none;
  border-color: #ef4444;
}
```

---

## 6. Smart Brush Cursor System

### Brush Cursor Styles
```css
/* Smart Brush Cursor System */
.viewport-canvas {
  cursor: none; /* Hide default cursor when brush is active */
}

.brush-cursor {
  position: absolute;
  pointer-events: none;
  z-index: 100;
  border-radius: 50%;
  border: 2px solid;
  background: rgba(255, 255, 255, 0.1);
  transform: translate(-50%, -50%);
  transition: all 0.1s ease;
}

/* Add Mode Cursor (Green) */
.brush-cursor.add-mode {
  border-color: #22c55e;
  box-shadow: 0 0 12px rgba(34, 197, 94, 0.4);
}

/* Delete Mode Cursor (Red) */
.brush-cursor.delete-mode {
  border-color: #ef4444;
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.4);
}

/* Brush Size Indicator */
.brush-cursor::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 4px;
  background: currentColor;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}
```

---

## 7. Popup & Modal Systems

### Add Contour Modal
```css
/* Add Contour Modal */
.add-contour-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  backdrop-filter: blur(4px);
}

.add-contour-content {
  background: hsl(var(--dicom-black));
  border: 2px solid hsl(var(--dicom-indigo));
  border-radius: 1rem;
  padding: 1.5rem;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

.modal-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: white;
}

.modal-close {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-close:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

/* Form Fields */
.form-group {
  margin-bottom: 1rem;
}

.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #d1d5db;
  margin-bottom: 0.5rem;
}

.form-input {
  width: 100%;
  padding: 0.75rem;
  background: hsl(var(--dicom-dark));
  border: 1px solid hsl(var(--dicom-gray));
  border-radius: 0.375rem;
  color: white;
  font-size: 0.875rem;
}

.form-input:focus {
  outline: none;
  border-color: hsl(var(--dicom-indigo));
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

.form-input::placeholder {
  color: #9ca3af;
}

/* Color Input Group */
.color-input-group {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.color-picker {
  width: 3rem;
  height: 2rem;
  padding: 0.25rem;
  background: transparent;
  border: 1px solid hsl(var(--dicom-gray));
  border-radius: 0.25rem;
  cursor: pointer;
}

.color-text-input {
  flex: 1;
}

/* Modal Actions */
.modal-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  padding-top: 1rem;
  border-top: 1px solid hsl(var(--dicom-gray));
}

.modal-btn {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid;
}

.modal-btn-cancel {
  background: transparent;
  border-color: hsl(var(--dicom-gray));
  color: #d1d5db;
}

.modal-btn-cancel:hover {
  background: hsl(var(--dicom-gray));
}

.modal-btn-primary {
  background: hsl(var(--dicom-indigo));
  border-color: hsl(var(--dicom-indigo));
  color: white;
}

.modal-btn-primary:hover {
  background: hsl(var(--dicom-purple));
  border-color: hsl(var(--dicom-purple));
}
```

---

## 8. Window/Level Controls

### Window Level Panel
```css
/* Window/Level Control Panel */
.window-level-panel {
  background: hsl(var(--dicom-dark));
  border: 1px solid hsl(var(--dicom-gray));
  border-radius: 0.5rem;
  padding: 1rem;
  margin-bottom: 1rem;
}

.window-level-header {
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
  margin-bottom: 0.75rem;
}

/* Slider Controls */
.slider-group {
  margin-bottom: 0.75rem;
}

.slider-label {
  display: flex;
  justify-content: between;
  align-items: center;
  font-size: 0.75rem;
  color: #d1d5db;
  margin-bottom: 0.375rem;
}

.slider-value {
  font-weight: 600;
  color: hsl(var(--dicom-yellow));
}

.window-level-slider {
  width: 100%;
  height: 0.375rem;
  background: hsl(var(--dicom-gray));
  border-radius: 0.25rem;
  appearance: none;
  cursor: pointer;
}

.window-level-slider::-webkit-slider-thumb {
  appearance: none;
  width: 0.875rem;
  height: 0.875rem;
  background: hsl(var(--dicom-yellow));
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 6px rgba(255, 215, 0, 0.4);
}

/* Preset Buttons */
.preset-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.375rem;
  margin-top: 0.75rem;
}

.preset-btn {
  padding: 0.375rem 0.5rem;
  background: hsl(var(--dicom-darker));
  border: 1px solid hsl(var(--dicom-gray));
  border-radius: 0.25rem;
  color: #d1d5db;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: white;
}

.preset-btn.active {
  background: hsl(var(--dicom-indigo));
  border-color: hsl(var(--dicom-indigo));
  color: white;
}
```

---

## 9. Responsive Design & Animations

### Breakpoints & Media Queries
```css
/* Responsive Design System */
@media (max-width: 1024px) {
  .medical-sidebar {
    width: 320px;
  }
  
  .contour-toolbar {
    bottom: 1rem;
    transform: translateX(-50%) scale(0.9);
  }
}

@media (max-width: 768px) {
  .superbeam-header {
    top: 0.5rem;
    left: 0.5rem;
    right: 0.5rem;
    padding: 0.5rem 1rem;
  }
  
  .medical-sidebar {
    width: 100vw;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
  }
  
  .medical-sidebar.open {
    transform: translateX(0);
  }
  
  .contour-toolbar {
    left: 50%;
    right: auto;
    bottom: 1rem;
    transform: translateX(-50%) scale(0.85);
  }
  
  .contour-settings-panel {
    left: 50%;
    transform: translateX(-50%) translateY(0);
    min-width: 260px;
  }
  
  .contour-settings-panel.open {
    transform: translateX(-50%) translateY(0);
  }
}

@media (max-width: 480px) {
  .superbeam-logo {
    font-size: 1rem;
    letter-spacing: 0.1em;
  }
  
  .structure-controls {
    grid-template-columns: repeat(3, 1fr);
  }
  
  .contour-tool-btn {
    width: 2.5rem;
    height: 2.5rem;
  }
}
```

### Animations & Transitions
```css
/* Animation Keyframes */
@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slide-in-right {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes glow {
  0%, 100% {
    box-shadow: 0 0 12px rgba(var(--structure-color-rgb), 0.4);
  }
  50% {
    box-shadow: 0 0 20px rgba(var(--structure-color-rgb), 0.6);
  }
}

/* Animation Classes */
.animate-slide-up {
  animation: slide-up 0.3s ease-out;
}

.animate-slide-in-right {
  animation: slide-in-right 0.3s ease-out;
}

.animate-fade-in {
  animation: fade-in 0.2s ease-out;
}

.animate-glow {
  animation: glow 2s ease-in-out infinite;
}

/* Hover Effects */
.hover-lift {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.hover-lift:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
}

.hover-scale {
  transition: transform 0.2s ease;
}

.hover-scale:hover {
  transform: scale(1.05);
}
```

---

## 10. CSS Custom Properties Integration

### Dynamic Structure Color System
```css
/* Dynamic Structure Color CSS Variables */
[data-structure-color] {
  --structure-color: attr(data-structure-color);
  --structure-color-rgb: attr(data-structure-color-rgb);
  --structure-color-muted: attr(data-structure-color-muted);
}

/* JavaScript Integration for Dynamic Colors */
/*
// Example JavaScript to set structure colors
function setStructureColors(element, color) {
  const rgb = hexToRgb(color);
  const muted = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`;
  
  element.style.setProperty('--structure-color', color);
  element.style.setProperty('--structure-color-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  element.style.setProperty('--structure-color-muted', muted);
  
  element.setAttribute('data-structure-color', color);
  element.setAttribute('data-structure-color-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  element.setAttribute('data-structure-color-muted', muted);
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}
*/
```

---

## 11. OHIF Integration Notes

### Key Integration Points

1. **Theme Override**: Replace OHIF's default theme with Superbeam's dark medical theme
2. **Sidebar Integration**: Adapt the medical sidebar to OHIF's panel system
3. **Toolbar Integration**: Replace OHIF's toolbar with the contour editing toolbar
4. **Viewport Styling**: Apply medical-grade viewport styling with proper DICOM colors
5. **RT Structure Integration**: Integrate RT structure visualization into OHIF's measurement/annotation system

### Required OHIF Customizations

```javascript
// OHIF Theme Configuration
const superbeamTheme = {
  colors: {
    primary: '#6366F1',
    secondary: '#A855F7', 
    background: '#000000',
    surface: '#0f0f19',
    text: '#ffffff',
    // ... other colors from the CSS above
  },
  // Apply custom CSS classes to OHIF components
  componentClasses: {
    viewport: 'superbeam-viewport',
    sidebar: 'medical-sidebar',
    toolbar: 'contour-toolbar',
    // ... other component mappings
  }
};
```

This comprehensive style guide provides all the necessary CSS and design specifications to migrate Superbeam's medical imaging interface to OHIF or any other medical imaging platform while maintaining the professional, medical-grade appearance and functionality.