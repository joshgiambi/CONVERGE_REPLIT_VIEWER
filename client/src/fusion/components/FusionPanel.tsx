import { FusionControlPanel } from '@/components/dicom/fusion-control-panel';
import { useFusionPanelState } from '../hooks/useFusionPanel';
import type { UseFusionPanelStateResult } from '@/types/fusion';

interface FusionPanelProps {
  minimized: boolean;
  onToggleMinimized: (minimized: boolean) => void;
  state?: UseFusionPanelStateResult;
}

export function FusionPanel({ minimized, onToggleMinimized, state: providedState }: FusionPanelProps) {
  const state = providedState ?? useFusionPanelState();

  if (!state.showPanel) {
    return null;
  }

  return (
    <FusionControlPanel
      opacity={state.opacity}
      onOpacityChange={state.setOpacity}
      secondaryOptions={state.secondaries}
      selectedSecondaryId={state.selectedSecondaryId}
      onSecondarySeriesSelect={state.setSelectedSecondaryId}
      secondaryStatuses={state.secondaryStatuses}
      manifestLoading={state.manifestLoading}
      manifestError={state.manifestError}
      minimized={minimized}
      onToggleMinimized={onToggleMinimized}
      windowLevel={state.fusionWindowLevel}
      onWindowLevelPreset={state.setFusionWindowLevel}
    />
  );
}
