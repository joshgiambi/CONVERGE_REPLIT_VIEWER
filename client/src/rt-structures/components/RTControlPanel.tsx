import { useMemo } from 'react';
import { useRT } from '@/rt-structures/RTProvider';

interface Props {
  onLoadRT?: () => void;
}

export function RTControlPanel({ onLoadRT }: Props) {
  const { rtStructures, selection, selectStructure, setStructureVisibility, setAllStructuresVisible } = useRT();

  const structures = rtStructures?.structures || [];
  const allVisible = selection.allStructuresVisible;

  const rows = useMemo(() => {
    return structures.map((s) => ({
      id: s.roiNumber,
      name: s.structureName,
      color: `rgb(${(s.color || [255, 255, 0]).join(',')})`,
    }));
  }, [structures]);

  return (
    <div className="rt-control-panel">
      <div className="header">
        <strong>RT Structures</strong>
        {onLoadRT && (
          <button onClick={onLoadRT} type="button">Load</button>
        )}
      </div>
      <div>
        <label>
          <input
            type="checkbox"
            checked={allVisible}
            onChange={(e) => setAllStructuresVisible(e.target.checked)}
          />
          Show all
        </label>
      </div>
      <div className="list">
        {rows.map((row) => {
          const selected = selection.selectedStructureIds.has(row.id);
          const visible = selection.visibility.get(row.id);
          return (
            <div key={row.id} className="row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, background: row.color, display: 'inline-block' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => selectStructure(row.id, e.target.checked)}
                />
                {row.name}
              </label>
              <label style={{ marginLeft: 'auto' }}>
                <input
                  type="checkbox"
                  checked={visible === undefined ? true : visible}
                  onChange={(e) => setStructureVisibility(row.id, e.target.checked)}
                />
                Visible
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RTControlPanel;


