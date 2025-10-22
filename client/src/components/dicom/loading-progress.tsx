import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Loader2, AlertCircle, CheckCircle2, Zap } from 'lucide-react';

interface LoadingState {
  seriesId?: number;
  progress: number;
  isLoading: boolean;
  completedCount?: number;
  totalCount?: number;
  errors?: string[];
}

interface LoadingProgressProps {
  loadingStates: Map<number, LoadingState>;
  className?: string;
}

interface LoadingProgressItemProps {
  seriesId: number;
  state: LoadingState;
  seriesInfo?: {
    description?: string;
    modality?: string;
    imageCount?: number;
  };
}

function LoadingProgressItem({ seriesId, state, seriesInfo }: LoadingProgressItemProps) {
  const { progress, isLoading, completedCount = 0, totalCount = 0, errors = [] } = state;
  
  const getStatusIcon = () => {
    if (errors.length > 0 && !isLoading) {
      return <AlertCircle className="w-4 h-4 text-orange-400" />;
    }
    if (isLoading) {
      return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
    }
    return <CheckCircle2 className="w-4 h-4 text-green-400" />;
  };

  const getStatusColor = () => {
    if (errors.length > 0) return 'border-orange-500/20 bg-orange-900/10';
    if (isLoading) return 'border-blue-500/20 bg-blue-900/10';
    return 'border-green-500/20 bg-green-900/10';
  };

  const getProgressColor = () => {
    if (errors.length > 0) return 'bg-orange-500';
    return 'bg-blue-500';
  };

  return (
    <div className={`p-3 rounded-lg ${getStatusColor()} border transition-all duration-300 bg-gray-800/50`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <div className="text-xs font-medium text-white">
            {seriesInfo?.description || `Series ${seriesId}`}
          </div>
          {seriesInfo?.modality && (
            <span className="px-1.5 py-0.5 text-[10px] bg-blue-600/80 text-white rounded font-medium">
              {seriesInfo.modality}
            </span>
          )}
        </div>
        {totalCount > 0 && (
          <div className="text-[10px] text-gray-400 font-mono">
            {completedCount}/{totalCount}
          </div>
        )}
      </div>

      <Progress
        value={progress}
        className="h-1.5 mb-1.5 bg-gray-700/50"
        style={{
          '--progress-color': getProgressColor()
        } as React.CSSProperties}
      />

      <div className="flex items-center justify-between text-[10px]">
        <span className={isLoading ? 'text-blue-300' : errors.length > 0 ? 'text-orange-300' : 'text-green-300'}>
          {isLoading ? 'Loading images...' :
           errors.length > 0 ? `${errors.length} errors` : 'Complete'}
        </span>
        <span className="text-gray-400 font-mono">{Math.round(progress)}%</span>
      </div>

      {errors.length > 0 && (
        <div className="mt-2 text-[10px] text-orange-300">
          <details>
            <summary className="cursor-pointer hover:text-orange-200 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              View errors ({errors.length})
            </summary>
            <div className="mt-1 space-y-1 text-gray-400 max-h-16 overflow-y-auto text-[10px]">
              {errors.slice(0, 3).map((error, i) => (
                <div key={i} className="truncate">{error}</div>
              ))}
              {errors.length > 3 && (
                <div className="text-orange-400">...and {errors.length - 3} more</div>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

export function LoadingProgress({ loadingStates, className = "" }: LoadingProgressProps) {
  if (loadingStates.size === 0) {
    return null;
  }

  const activeStates = Array.from(loadingStates.entries()).filter(([_, state]) =>
    state.isLoading || (state.errors?.length ?? 0) > 0 || (state.completedCount ?? 0) < (state.totalCount ?? 0)
  );

  if (activeStates.length === 0) {
    return null;
  }

  return (
    <div className={`fixed bottom-4 right-4 w-96 z-50 pointer-events-none animate-in fade-in-0 slide-in-from-right-4 duration-300 ${className}`}>
      <div className="bg-gray-900/95 backdrop-blur-xl border border-blue-500/40 rounded-xl p-4 shadow-2xl shadow-blue-500/20 pointer-events-auto">
        <div className="flex items-center gap-2 mb-3">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
          <span className="text-sm font-medium text-white">Loading Fusion Images</span>
        </div>

        <div className="space-y-2 max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
          {activeStates.map(([seriesId, state]) => (
            <LoadingProgressItem
              key={seriesId}
              seriesId={seriesId}
              state={state}
              // You can extend this to pass actual series info
            />
          ))}
        </div>

        {activeStates.some(([_, state]) => state.isLoading) && (
          <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center gap-2 text-xs text-gray-400">
            <Zap className="w-3 h-3 text-blue-400" />
            <span>Background loading - viewer remains interactive</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Compact version for embedding in other components
export function CompactLoadingProgress({ 
  loadingStates, 
  className = "",
  showLabel = true 
}: LoadingProgressProps & { showLabel?: boolean }) {
  const activeLoading = Array.from(loadingStates.values()).filter(state => state.isLoading);
  
  if (activeLoading.length === 0) {
    return null;
  }

  const totalProgress = activeLoading.reduce((sum, state) => sum + state.progress, 0) / activeLoading.length;
  const totalCompleted = activeLoading.reduce((sum, state) => sum + (state.completedCount || 0), 0);
  const totalCount = activeLoading.reduce((sum, state) => sum + (state.totalCount || 0), 0);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
      {showLabel && (
        <span className="text-sm text-blue-400">
          Loading {activeLoading.length} series ({totalCompleted}/{totalCount})
        </span>
      )}
      <div className="w-24">
        <Progress value={totalProgress} className="h-1 bg-gray-700" />
      </div>
      <span className="text-xs text-gray-400 min-w-[3rem]">
        {Math.round(totalProgress)}%
      </span>
    </div>
  );
}
