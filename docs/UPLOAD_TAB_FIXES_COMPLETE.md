# Upload Tab Fixes - Complete

## Problem Statement

The upload tab had inconsistent state management requiring users to navigate away and back to properly see uploaded data and continue workflows.

## Root Causes Identified

1. **Parse completion left stale state** - `parseResult` wasn't cleared when moving to triage
2. **Conflicting visibility conditions** - Triage sessions hidden when `parseResult` existed
3. **"View Patients" button didn't work** - Didn't clear state or switch tabs
4. **Excessive polling** - Continuously polled every 3 seconds even when idle

## Fixes Applied

### 1. Parse Completion State Management
**File**: `client/src/components/dicom/dicom-uploader.tsx` (Lines 155-173)

**Before**:
```typescript
if (session.status === 'complete' && session.result) {
  setParseResult(session.result); // ❌ Leaves stale state
  setIsUploading(false);
  checkTriageSessions();
}
```

**After**:
```typescript
if (session.status === 'complete' && session.result) {
  // Clear all parsing state
  setParseResult(null);
  setParseSession(null);
  setProcessingMessage('');
  setIsUploading(false);

  // Refresh triage sessions to show the new one
  await checkTriageSessions();

  // Notify user
  toast({
    title: "Parsing complete",
    description: `Ready to import ${session.result?.patientPreviews?.length || 1} patient(s)`,
  });
}
```

**Impact**: Triage sessions now appear immediately after parsing completes.

---

### 2. Triage Session Visibility
**File**: `client/src/components/dicom/dicom-uploader.tsx` (Line 836)

**Before**:
```typescript
{triageSessions.length > 0 && !isUploading && !parseResult && (
  // ❌ Hidden if parseResult exists
```

**After**:
```typescript
{triageSessions.length > 0 && !isUploading && (
  // ✅ Shows whenever sessions exist and not uploading
```

**Impact**: Triage sessions visible as soon as they're available.

---

### 3. View Patients Button
**File**: `client/src/components/dicom/dicom-uploader.tsx` (Lines 1118-1138)

**Before**:
```typescript
<Button onClick={() => setLocation('/')}>
  Go to Patient Manager
</Button>
```

**After**:
```typescript
<Button onClick={() => {
  // Clear import success state
  setImportSuccess(null);
  setParseResult(null);
  setError(null);

  // Navigate to patient manager
  setLocation('/');

  // Switch to patients tab
  window.dispatchEvent(new CustomEvent('switchToTab', { detail: 'patients' }));

  // Refresh patient list
  queryClient.invalidateQueries({ queryKey: ['/api/patients'] });
}}>
  View Patients
</Button>
```

**Impact**: Button now properly clears state, switches tabs, and shows patient list.

---

### 4. Patient Manager Tab Switching
**File**: `client/src/pages/patient-manager.tsx` (Lines 243-253)

**Added**:
```typescript
// Listen for tab switch events from upload component
useEffect(() => {
  const handleTabSwitch = (event: CustomEvent) => {
    if (event.detail && typeof event.detail === 'string') {
      setActiveTab(event.detail);
    }
  };

  window.addEventListener('switchToTab', handleTabSwitch as EventListener);
  return () => window.removeEventListener('switchToTab', handleTabSwitch as EventListener);
}, []);
```

**Impact**: Upload component can now programmatically switch tabs in patient manager.

---

### 5. Optimized Polling
**File**: `client/src/components/dicom/dicom-uploader.tsx` (Lines 207-216)

**Before**:
```typescript
const interval = setInterval(() => {
  checkUnprocessedFiles();
  checkTriageSessions();
}, 3000); // ❌ Always polling every 3 seconds
```

**After**:
```typescript
const interval = setInterval(() => {
  if (!isUploading) {
    checkTriageSessions();
  }
}, 5000); // ✅ Only when idle, every 5 seconds
```

**Impact**: Reduced API calls by ~40%, less re-renders.

---

### 6. Import More Button
**File**: `client/src/components/dicom/dicom-uploader.tsx` (Lines 1140-1152)

**Before**:
```typescript
<Button onClick={() => setImportSuccess(null)}>
  Import More Files
</Button>
```

**After**:
```typescript
<Button onClick={() => {
  setImportSuccess(null);
  setParseResult(null);
  setError(null);
  checkTriageSessions();
}}>
  Import More Files
</Button>
```

**Impact**: Properly resets all state for next upload.

---

## User Workflow (Before vs After)

### Before (Broken) ❌
```
1. Upload files → Progress shows
2. Parsing completes → ???
3. Navigate away from page
4. Navigate back to page
5. Triage session appears → Click Import
6. Success dialog → Click "View Patients"
7. Nothing happens
8. Navigate away again
9. Finally see patients
```

### After (Fixed) ✅
```
1. Upload files → Progress shows
2. Parsing completes → Toast notification + Triage session appears immediately
3. Click "Import" → Importing shows
4. Success dialog → Click "View Patients"
5. Page switches to Patients tab, shows imported data
6. OR click "Import More" → Success clears, ready for next upload
```

---

## Testing Checklist

- [x] Upload DICOM files
- [x] Parsing shows progress
- [x] Parsing completes → Triage session appears immediately
- [x] Import from triage → Success dialog shows
- [x] Click "View Patients" → Switches to patients tab
- [x] Click "Import More" → State resets cleanly
- [x] Upload again → Works without page refresh
- [x] Navigate away during parse → Can return and see progress
- [x] No excessive API polling when idle

---

## Performance Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Polling frequency | 3s | 5s | 40% fewer API calls |
| Conditional polling | Always | Only when idle | Stops when uploading |
| State clearing | Manual | Automatic | Better UX |
| Tab switching | Broken | Works | Navigation fixed |

---

## Files Modified

1. `client/src/components/dicom/dicom-uploader.tsx`
   - Lines 155-173: Parse completion handler
   - Line 836: Triage visibility condition
   - Lines 1118-1152: Button handlers
   - Lines 207-216: Polling optimization

2. `client/src/pages/patient-manager.tsx`
   - Lines 243-253: Tab switch event listener

---

## Summary

The upload tab now has **consistent state management** with a clear workflow:

**Upload → Parse → Triage → Import → Success → Reset**

Users no longer need to navigate away and back - everything updates automatically and buttons work as expected.