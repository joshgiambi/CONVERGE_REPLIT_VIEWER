# Simple RT Structure Selection Check

Since I can't see your console logs directly, let's do a simpler check.

## Quick Test

**Open the viewer and then answer these questions:**

### 1. Which RT structure is VISUALLY selected in the sidebar?
Look at the left sidebar under the CT series. Which RT structure button appears highlighted/selected?

**Answer:** _______________

### 2. Does the Structures accordion section show any structures?
Look for an "Structures" section in the left sidebar. Is it expanded? Does it show a list of structures (organs/targets)?

**Answer:** Yes / No

If YES, how many structures are listed? _______________

### 3. Are the structures rendered on the CT image?
Do you see colored contours/outlines drawn on the CT images?

**Answer:** Yes / No

### 4. Does clicking on the RT structure in the sidebar change anything?
Click on the RT structure button in the sidebar. Does anything happen?

**Answer:** _______________

## Based on Your Answers

### Scenario A: RT selected, NO structures in menu, NO contours on image
**Problem**: `handleRTSeriesSelect` is not being called OR API request is failing

**Quick fix test**: Click on the RT structure button in the sidebar manually. If structures then appear, the auto-selection is not calling the handler.

### Scenario B: RT selected, structures in menu, but NO contours on image
**Problem**: Structures loaded but not rendering

**This is a rendering issue**, not a selection issue.

### Scenario C: RT selected, structures in menu, contours on image
**Problem**: Everything works!

If this is the case, then what's the actual issue you're seeing?

### Scenario D: Wrong RT selected, structures showing but for wrong RT
**Problem**: Selection logic picking wrong RT (referencedSeriesId issue)

**Need to check database**: Which RT has which referencedSeriesId

## Manual Database Check (if needed)

If you have database access, run this query to see RT references:

```sql
SELECT
  s.id,
  s.modality,
  s.series_description,
  s.referenced_series_id,
  s.study_id
FROM series s
WHERE s.study_id = <YOUR_STUDY_ID>
AND s.modality IN ('RTSTRUCT', 'CT')
ORDER BY s.modality DESC, s.series_date DESC;
```

Replace `<YOUR_STUDY_ID>` with the study ID from the viewer URL.

Look for:
- RT structures with `referenced_series_id` = NULL (bad)
- RT structures with `referenced_series_id` pointing to wrong CT (bad)
- RT structures with `referenced_series_id` pointing to correct CT (good)

## Quick Browser Test

Open browser console (F12) and run this:

```javascript
// Check what's selected
const selectedRT = document.querySelector('[class*="bg-green-600"]');
console.log('Selected RT button text:', selectedRT?.textContent);

// Check structures accordion
const structuresAccordion = document.querySelector('[value="structures"]');
console.log('Structures accordion exists:', !!structuresAccordion);

// Check if structures are listed
const structureItems = document.querySelectorAll('[role="checkbox"]');
console.log('Number of structure checkboxes:', structureItems.length);
```

This will show:
1. Which RT button is selected (by CSS class)
2. If structures accordion exists
3. How many structures are in the list

## Let me know

Just tell me:
1. **What you SEE** (which RT is highlighted in sidebar)
2. **What's MISSING** (no structures list? no contours on image?)
3. **What SHOULD happen** (which RT should be selected? should structures show?)

Then I can pinpoint the exact issue without needing console logs.