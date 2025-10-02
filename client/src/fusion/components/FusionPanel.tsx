import { FusionControlPanel } from '@/components/dicom/fusion-control-panel';
import { useFusionPanelState } from '../hooks/useFusionPanel';

interface FusionPanelProps {
  minimized: boolean;
  onToggleMinimized: (minimized: boolean) => void;
}

export function FusionPanel({ minimized, onToggleMinimized }: FusionPanelProps) {
  const state = useFusionPanelState();

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
