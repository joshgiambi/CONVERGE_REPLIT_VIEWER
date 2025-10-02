import { Badge } from '@/components/ui/badge';

interface RTOverlayLayerProps {
  rtStructures: any;
  showStructures: boolean;
}

export function RTOverlayLayer({ rtStructures, showStructures }: RTOverlayLayerProps) {
  if (!rtStructures) {
    return null;
  }

  const structureCount = rtStructures?.structures?.length ?? 0;

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/50 rounded-lg">
      <Badge
        variant={showStructures ? 'default' : 'secondary'}
        className={showStructures
          ? 'bg-green-600/80 text-white border-green-500/50'
          : 'bg-gray-700/50 text-gray-300'}
      >
        RT ({structureCount})
      </Badge>
      <span className="text-xs text-gray-400">
        {showStructures ? 'Visible' : 'Hidden'}
      </span>
    </div>
  );
}
