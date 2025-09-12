import React from 'react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, AlertCircle, CheckCircle2, Download, Image, Zap } from 'lucide-react';

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
    <Card className={`p-3 ${getStatusColor()} border transition-all duration-300 pointer-events-auto`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <div className="text-sm font-medium text-white">
            {seriesInfo?.description || `Series ${seriesId}`}
          </div>
          {seriesInfo?.modality && (
            <span className="px-1.5 py-0.5 text-xs bg-indigo-600 text-white rounded">
              {seriesInfo.modality}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-400">
          {completedCount}/{totalCount}
        </div>
      </div>
      
      <Progress 
        value={progress} 
        className="h-2 mb-2 bg-gray-700"
        style={{
          '--progress-color': getProgressColor()
        } as React.CSSProperties}
      />
      
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>
          {isLoading ? 'Loading images...' : 
           errors.length > 0 ? `${errors.length} errors` : 'Complete'}
        </span>
        <span>{Math.round(progress)}%</span>
      </div>
      
      {errors.length > 0 && (
        <div className="mt-2 text-xs text-orange-300">
          <details>
            <summary className="cursor-pointer hover:text-orange-200">
              View errors ({errors.length})
            </summary>
            <div className="mt-1 space-y-1 text-gray-400 max-h-20 overflow-y-auto">
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
    </Card>
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
    <div className={`fixed top-4 right-4 w-80 z-30 space-y-2 pointer-events-none ${className}`}>
      <div className="bg-black/90 backdrop-blur-sm border border-gray-700 rounded-lg p-3 pointer-events-auto">
        <div className="flex items-center gap-2 mb-3">
          <Download className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-white">Loading Images</span>
        </div>
        
        <div className="space-y-2 max-h-96 overflow-y-auto">
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
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            <Zap className="w-3 h-3" />
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
