import { Badge } from '@/components/ui/badge';

interface FusionOverlayLayerProps {
  secondarySeriesId: number | null;
  modality: string;
  opacity: number;
}

export function FusionOverlayLayer({ secondarySeriesId, modality, opacity }: FusionOverlayLayerProps) {
  if (!secondarySeriesId) {
    return null;
  }

  const normalizedModality = modality.toUpperCase();
  const badgeClass = normalizedModality === 'PT'
    ? 'bg-yellow-900/40 text-yellow-200 border-yellow-600/30'
    : normalizedModality === 'CT'
      ? 'bg-blue-900/40 text-blue-200 border-blue-600/30'
      : 'bg-purple-900/40 text-purple-200 border-purple-600/30';

  const pulseClass = normalizedModality === 'PT'
    ? 'bg-yellow-400'
    : normalizedModality === 'CT'
      ? 'bg-blue-400'
      : 'bg-purple-400';

  const accentClass = normalizedModality === 'PT'
    ? 'text-yellow-300'
    : normalizedModality === 'CT'
      ? 'text-blue-300'
      : 'text-purple-300';

  const label = normalizedModality === 'PT' ? 'PT' : normalizedModality === 'CT' ? 'CT' : normalizedModality || 'Overlay';

  return (
    <Badge className={`flex items-center gap-1 border backdrop-blur-sm ${badgeClass}`}>
      <div className={`w-2 h-2 rounded-full animate-pulse ${pulseClass}`} />
      {label} Fusion
      <span className={accentClass}>({Math.round(opacity * 100)}%)</span>
    </Badge>
  );
}
