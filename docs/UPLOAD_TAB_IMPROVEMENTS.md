# Upload Tab Improvements

## Issues Identified

### 1. **Complex Conditional Rendering**
The component has overlapping visibility conditions that cause sections to hide/show inconsistently:

- Line 827: `{triageSessions.length > 0 && !isUploading && !parseResult &&`
- Line 922: `{unprocessedFiles.length > 0 && !isUploading && triageSessions.length === 0 &&`
- Line 987: `{parseResult && !triageSessions.some(t => ...`

**Problem**: These conditions compete, causing triage sessions to not show when expected.

### 2. **State Not Properly Cleared After Import**
After successful import:
- `parseResult` lingers
- `importSuccess` requires manual dismiss
- User must navigate away and back to see updated state

**Problem**: Workflow doesn't naturally reset to allow next upload.

### 3. **Excessive Polling**
Lines 199-203: Polls every 3 seconds continuously, even when no active session:

```typescript
const interval = setInterval(() => {
  checkUnprocessedFiles();
  checkTriageSessions();
}, 3000);
```

**Problem**: Wastes resources, causes unnecessary re-renders.

### 4. **Parse Session Completion Flow**
When parsing completes (line 156):
- Sets `parseResult`
- Calls `checkTriageSessions()`
- But doesn't properly transition to showing triage sessions

**Problem**: User sees "parsing complete" but triage session doesn't appear without refresh.

## Recommended Fixes

### Fix 1: Simplify State Machine

Replace multiple boolean flags with single workflow state:

```typescript
type WorkflowState = 'idle' | 'uploading' | 'ready-to-import' | 'importing' | 'success';
const [workflowState, setWorkflowState] = useState<WorkflowState>('idle');
```

### Fix 2: Auto-Reset After Success

When import completes, automatically return to idle after showing success:

```typescript
// After import success
setImportSuccess(result);
setWorkflowState('success');

// Auto-reset after 5 seconds
setTimeout(() => {
  setWorkflowState('idle');
  setImportSuccess(null);
  loadTriageSessions(); // Refresh to show any pending
}, 5000);
```

### Fix 3: Smart Polling

Only poll when actively needed:

```typescript
// Start polling only during upload
useEffect(() => {
  if (workflowState === 'uploading' && parseSessionId) {
    const interval = setInterval(() => {
      pollParseSession(parseSessionId);
    }, 500);
    return () => clearInterval(interval);
  }
}, [workflowState, parseSessionId]);

// Load triage once on mount, then only after completion
useEffect(() => {
  loadTriageSessions();
}, []);
```

### Fix 4: Proper Parse Completion

When parsing completes:

```typescript
if (session.status === 'complete') {
  stopPolling();
  localStorage.removeItem('currentParseSessionId');

  // Clear parse state
  setParseResult(null);
  setParseSession(null);
  setWorkflowState('idle');

  // Reload triage sessions - this will show the new session
  await loadTriageSessions();

  toast({
    title: "Ready to import",
    description: `${session.result?.patientPreviews?.length || 1} patient(s) parsed successfully`,
  });
}
```

### Fix 5: Simplified Visibility Logic

Show sections based solely on workflow state:

```typescript
{/* Show Upload Area - Always visible but disabled when busy */}
<Card className={workflowState === 'uploading' || workflowState === 'importing' ? 'opacity-50' : ''}>
  <Dropzone disabled={workflowState !== 'idle'} />
</Card>

{/* Show Triage Sessions - When idle and sessions exist */}
{workflowState === 'idle' && triageSessions.length > 0 && (
  <TriageSessions sessions={triageSessions} />
)}

{/* Show Success - When success state */}
{workflowState === 'success' && importResult && (
  <SuccessCard result={importResult} onReset={() => setWorkflowState('idle')} />
)}
```

## Implementation Plan

### Quick Fixes (High Impact, Low Risk)

1. **Fix Parse Completion** (Lines 154-164)
   ```typescript
   // Clear parseResult when moving to triage
   if (session.status === 'complete' && session.result) {
     setParseResult(null); // ADD THIS
     setParseSession(null);
     // ... rest of code
   }
   ```

2. **Auto-Reset Success State** (Lines 1067-1126)
   ```typescript
   // Add auto-reset button
   <Button onClick={() => {
     setImportSuccess(null);
     setParseResult(null);
     checkTriageSessions();
   }}>
     Upload More Files
   </Button>
   ```

3. **Conditional Polling** (Lines 198-204)
   ```typescript
   // Only poll when uploading
   useEffect(() => {
     if (!isUploading) return;

     const interval = setInterval(() => {
       checkTriageSessions();
     }, 3000);

     return () => clearInterval(interval);
   }, [isUploading]);
   ```

### Medium Fixes (Refactor Existing Code)

1. **Consolidate Triage Display** (Lines 827-919)
   - Remove `!parseResult` condition
   - Show triage sessions whenever they exist and not actively uploading

2. **Simplify Parse Result Display** (Lines 986-1064)
   - Remove check for "already in triage"
   - This section should only show immediately after parse, not persist

### Long-Term Improvements

1. **State Machine Refactor**
   - Replace boolean flags with single `workflowState`
   - Use reducer pattern for complex state transitions

2. **Separate Components**
   - Extract `TriageSessionCard`
   - Extract `SuccessDisplay`
   - Extract `UploadProgress`

## Testing Checklist

After fixes:

- [ ] Upload files → parsing shows progress
- [ ] Parsing completes → triage session appears automatically
- [ ] Import from triage → success shows, then auto-resets
- [ ] Navigate away during parse → can return and see progress
- [ ] Multiple uploads → each session appears in triage
- [ ] Delete session → removed from list
- [ ] No infinite loops or excessive re-renders

## Code Locations

| Issue | File | Lines |
|-------|------|-------|
| Parse completion | dicom-uploader.tsx | 154-164 |
| Triage visibility | dicom-uploader.tsx | 827-919 |
| Success state | dicom-uploader.tsx | 1067-1126 |
| Polling logic | dicom-uploader.tsx | 198-204 |
| Import handler | dicom-uploader.tsx | 298-488 |

## Priority

1. **CRITICAL**: Fix parse completion to clear `parseResult`
2. **HIGH**: Simplify triage visibility condition
3. **MEDIUM**: Add auto-reset to success state
4. **LOW**: Refactor to state machine pattern