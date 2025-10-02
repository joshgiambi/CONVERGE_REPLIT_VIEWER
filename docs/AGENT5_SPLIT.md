# Agent 5: Two-Track Parallel Split

**Date**: 2025-10-02  
**Reason**: Agent 5's work can be parallelized for faster completion  
**Estimated Total**: 28 hours → Split to ~14 hours per track (running in parallel)

---

## 🎯 Overview

Agent 5's integration work is split into **two parallel tracks**:

### **Track A: Fusion Infrastructure Polish** (Agent 5A)
- **Owner**: Backend/Provider specialist
- **Focus**: Finish fusion plumbing to match legacy behavior exactly
- **Duration**: ~14 hours
- **Dependencies**: None (can start immediately)

### **Track B: UI Parity & Wiring** (Agent 5B)
- **Owner**: UI Integration specialist
- **Focus**: Import legacy UI components and wire to new providers
- **Duration**: ~14 hours
- **Dependencies**: Needs Track A's registration metadata for proper labels

---

## 📋 Work Distribution

| Track | Agent | Focus | Deliverable |
|-------|-------|-------|-------------|
| **A** | 5A | Fusion infrastructure | Registration metadata + tests |
| **B** | 5B | UI component wiring | Legacy UI imported + parity verified |

---

## 🔄 Coordination Strategy

### **Parallel Work (0-8 hours)**
- **Track A**: Registration metadata passthrough (critical for Track B)
- **Track B**: Series selector + basic toolbar wiring (can start with placeholders)

### **Track A Gates Track B (8 hours)**
- Track A must complete registration metadata before Track B tests fusion panel
- Track B waits for metadata, continues with RT toolbar wiring

### **Merge Point (14 hours)**
- Both tracks complete
- Final integration testing
- User validation

---

## 📂 Detailed Instructions

**Agent 5A**: Read `docs/AGENT5A_INFRASTRUCTURE.md`  
**Agent 5B**: Read `docs/AGENT5B_UI_INTEGRATION.md`

---

## 📝 Shared Status Tracking

Both agents use: `docs/AGENT5_STATUS.md`

**Log format**:
```markdown
## [Agent 5A/5B] - [Date/Time]
**Task**: [What you're working on]
**Status**: [In Progress / Complete / Blocked]
**Blocker**: [If blocked, what's needed]
**Files Changed**: [List files]
**Next**: [What you'll do next]
```

---

## ✅ Success Criteria

**Track A Complete When**:
- ✅ Registration metadata includes description/modality/UID
- ✅ Manifest multi-secondary test passes
- ✅ Dev logs show correct data
- ✅ Fusion panel shows proper labels

**Track B Complete When**:
- ✅ Series selector matches legacy
- ✅ All RT toolbars imported and wired
- ✅ Fusion panel matches legacy
- ✅ Side-by-side parity test passes

**Both Complete When**:
- ✅ User says: "I can't tell the difference between /viewer and /viewer-v2"

---

## 🚨 Coordination Rules

**DO**:
- ✅ Update `AGENT5_STATUS.md` every 2-3 hours
- ✅ Test your changes in `/viewer-v2`
- ✅ Commit frequently with clear messages
- ✅ Flag blockers immediately

**DON'T**:
- ❌ Modify the same file simultaneously (coordinate first)
- ❌ Wait for the other agent if you can proceed
- ❌ Skip testing your changes
- ❌ Make assumptions about the other track's work

---

## 📍 Key Reference Documents

**Both Agents**:
- `docs/AGENT5_STATUS.md` - Shared status log
- `docs/FUSION_REFACTOR_TRACKING.md` - Overall progress
- `docs/UI_COMPARISON.md` - Parity checklist

**Agent 5A**:
- `docs/AGENT5A_INFRASTRUCTURE.md` - Your detailed plan
- `docs/FRAME_OF_REFERENCE_REGISTRATION.md` - Registration details

**Agent 5B**:
- `docs/AGENT5B_UI_INTEGRATION.md` - Your detailed plan
- `docs/RT_PROVIDER_INTEGRATION_GUIDE.md` - Wiring patterns
- `client/src/rt-structures/components/RTControlPanelDemo.tsx` - Reference

---

## 🎯 Start Here

1. **Both agents**: Read this document completely
2. **Agent 5A**: Read `docs/AGENT5A_INFRASTRUCTURE.md` and start Track A
3. **Agent 5B**: Read `docs/AGENT5B_UI_INTEGRATION.md` and start Track B
4. **Both**: Update `docs/AGENT5_STATUS.md` when you start

---

**Estimated Completion**: 14 hours (parallel) vs 28 hours (sequential)  
**Current Status**: Ready to begin

Let's ship it! 🚀

