/**
 * RTControlPanelDemo - REFERENCE IMPLEMENTATION ONLY
 * 
 * This component demonstrates how to wire brush/pen/boolean controls
 * to the RTProvider. It is NOT used in production.
 * 
 * For production UI, see:
 * - RTControlPanel.tsx (legacy-matching structure list only)
 * - docs/RT_PROVIDER_INTEGRATION_GUIDE.md (how to adapt legacy toolbars)
 * 
 * Agent 5: Use this as a reference when mounting legacy toolbars into ViewerV2.
 */

import { useMemo, useState } from 'react';
import { useRT } from '@/rt-structures/RTProvider';
import { createContourOperationsService } from '@/rt-structures/services/ContourOperationsService';

interface Props {
  onLoadRT?: () => void;
}

export function RTControlPanelDemo({ onLoadRT }: Props) {
  const { 
    rtStructures, 
    selection, 
    selectStructure, 
    setStructureVisibility, 
    setAllStructuresVisible,
    brush,
    pen,
    setBrushSize,
    setBrushMode,
    setBrushEnabled,
    setPenMode,
    setPenEnabled,
    busy,
    setBusy,
    setStructures,
    saveHistory,
    setPreviewContours,
    clearPreview,
  } = useRT();

  const [previewMode, setPreviewMode] = useState(false);
  const [sourceStructureId, setSourceStructureId] = useState<number | null>(null);
  const [targetStructureId, setTargetStructureId] = useState<number | null>(null);
  const [booleanOp, setBooleanOp] = useState<'union' | 'subtract' | 'intersect'>('union');

  const structures = rtStructures?.structures || [];
  const allVisible = selection.allStructuresVisible;

  const rows = useMemo(() => {
    return structures.map((s) => ({
      id: s.roiNumber,
      name: s.structureName,
      color: `rgb(${(s.color || [255, 255, 0]).join(',')})`,
    }));
  }, [structures]);

  const handleBooleanPreview = async () => {
    if (!rtStructures || sourceStructureId === null || targetStructureId === null) return;
    setBusy(true);
    try {
      const service = createContourOperationsService();
      const previews = await service.previewBooleanOperation(
        rtStructures,
        sourceStructureId,
        targetStructureId,
        booleanOp
      );
      setPreviewContours(previews);
      setPreviewMode(true);
    } catch (err) {
      console.error('Boolean preview failed', err);
    } finally {
      setBusy(false);
    }
  };

  const handleBooleanApply = async () => {
    if (!rtStructures || sourceStructureId === null || targetStructureId === null) return;
    setBusy(true);
    try {
      const service = createContourOperationsService();
      const result = await service.booleanOperationMultiSlice(
        rtStructures,
        sourceStructureId,
        targetStructureId,
        booleanOp
      );
      setStructures(result);
      saveHistory(`boolean_${booleanOp}`, sourceStructureId);
      clearPreview();
      setPreviewMode(false);
    } catch (err) {
      console.error('Boolean operation failed', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rt-control-panel-demo" style={{ maxWidth: 320, fontSize: '13px', border: '2px dashed orange', padding: 8 }}>
      <div style={{ background: '#ff6b00', color: 'white', padding: 4, marginBottom: 8, fontSize: '10px', fontWeight: 'bold' }}>
        ⚠️ DEMO ONLY - NOT FOR PRODUCTION
      </div>
      
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>RT Structures</strong>
        {onLoadRT && (
          <button onClick={onLoadRT} type="button" style={{ fontSize: '11px', padding: '2px 6px' }}>Load</button>
        )}
      </div>
      
      {/* Structure List */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px', marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={allVisible}
            onChange={(e) => setAllStructuresVisible(e.target.checked)}
          />
          Show all
        </label>
        <div className="list" style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #444', borderRadius: 4, padding: 4 }}>
          {rows.map((row) => {
            const selected = selection.selectedStructureIds.has(row.id);
            const visible = selection.visibility.get(row.id);
            return (
              <div key={row.id} className="row" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', fontSize: '11px' }}>
                <span style={{ width: 8, height: 8, background: row.color, display: 'inline-block', flexShrink: 0 }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => selectStructure(row.id, e.target.checked)}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                </label>
                <input
                  type="checkbox"
                  checked={visible === undefined ? true : visible}
                  onChange={(e) => setStructureVisibility(row.id, e.target.checked)}
                  title="Visible"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Brush Tool Controls - DEMO */}
      <div style={{ marginBottom: 12, padding: 8, border: '1px solid #444', borderRadius: 4, background: '#1a1a1a' }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: '12px' }}>Brush Tool (Demo)</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <button
            onClick={() => { setBrushMode('add'); setBrushEnabled(true); setPenEnabled(false); }}
            style={{ flex: 1, fontSize: '11px', padding: '4px', background: brush.enabled && brush.mode === 'add' ? '#3b82f6' : '#374151' }}
          >
            Add
          </button>
          <button
            onClick={() => { setBrushMode('erase'); setBrushEnabled(true); setPenEnabled(false); }}
            style={{ flex: 1, fontSize: '11px', padding: '4px', background: brush.enabled && brush.mode === 'erase' ? '#ef4444' : '#374151' }}
          >
            Erase
          </button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px' }}>
          Size (mm):
          <input
            type="number"
            value={brush.size}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            min="1"
            max="50"
            style={{ width: 50, padding: '2px 4px', fontSize: '11px' }}
          />
        </label>
      </div>

      {/* Pen Tool Controls - DEMO */}
      <div style={{ marginBottom: 12, padding: 8, border: '1px solid #444', borderRadius: 4, background: '#1a1a1a' }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: '12px' }}>Pen Tool (Demo)</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => { setPenMode('add'); setPenEnabled(true); setBrushEnabled(false); }}
            style={{ flex: 1, fontSize: '11px', padding: '4px', background: pen.enabled && pen.mode === 'add' ? '#10b981' : '#374151' }}
          >
            Add
          </button>
          <button
            onClick={() => { setPenMode('cut'); setPenEnabled(true); setBrushEnabled(false); }}
            style={{ flex: 1, fontSize: '11px', padding: '4px', background: pen.enabled && pen.mode === 'cut' ? '#f59e0b' : '#374151' }}
          >
            Cut
          </button>
        </div>
      </div>

      {/* Boolean Operations - DEMO */}
      <div style={{ padding: 8, border: '1px solid #444', borderRadius: 4, background: '#1a1a1a' }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: '12px' }}>Boolean Operations (Demo)</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <select
            value={sourceStructureId ?? ''}
            onChange={(e) => setSourceStructureId(Number(e.target.value) || null)}
            style={{ flex: 1, fontSize: '11px', padding: '2px 4px' }}
          >
            <option value="">Source...</option>
            {structures.map((s) => (
              <option key={s.roiNumber} value={s.roiNumber}>{s.structureName}</option>
            ))}
          </select>
          <select
            value={booleanOp}
            onChange={(e) => setBooleanOp(e.target.value as any)}
            style={{ fontSize: '11px', padding: '2px 4px' }}
          >
            <option value="union">∪</option>
            <option value="subtract">−</option>
            <option value="intersect">∩</option>
          </select>
          <select
            value={targetStructureId ?? ''}
            onChange={(e) => setTargetStructureId(Number(e.target.value) || null)}
            style={{ flex: 1, fontSize: '11px', padding: '2px 4px' }}
          >
            <option value="">Target...</option>
            {structures.map((s) => (
              <option key={s.roiNumber} value={s.roiNumber}>{s.structureName}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={handleBooleanPreview}
            disabled={busy || sourceStructureId === null || targetStructureId === null}
            style={{ flex: 1, fontSize: '11px', padding: '4px', background: previewMode ? '#eab308' : '#374151' }}
          >
            {previewMode ? 'Preview Active' : 'Preview'}
          </button>
          <button
            onClick={handleBooleanApply}
            disabled={busy || sourceStructureId === null || targetStructureId === null}
            style={{ flex: 1, fontSize: '11px', padding: '4px', background: '#10b981' }}
          >
            Apply
          </button>
          {previewMode && (
            <button
              onClick={() => { clearPreview(); setPreviewMode(false); }}
              style={{ fontSize: '11px', padding: '4px', background: '#6b7280' }}
            >
              Clear
            </button>
          )}
        </div>
        {busy && <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: 4 }}>Processing...</div>}
      </div>
    </div>
  );
}

export default RTControlPanelDemo;

