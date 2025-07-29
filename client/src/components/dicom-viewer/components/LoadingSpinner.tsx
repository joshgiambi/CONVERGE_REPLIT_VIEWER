/**
 * Loading spinner component for DICOM viewer
 * Extracted from monolithic WorkingViewer component
 */

import { Card } from "@/components/ui/card";

interface LoadingSpinnerProps {
  message?: string;
  progress?: { loaded: number; total: number };
  className?: string;
}

/**
 * Loading spinner with progress indication
 */
export function LoadingSpinner({ 
  message = "Loading...", 
  progress,
  className = "" 
}: LoadingSpinnerProps) {
  const progressPercentage = progress 
    ? Math.round((progress.loaded / progress.total) * 100)
    : 0;

  return (
    <Card className={`p-8 text-center ${className}`}>
      <div className="flex flex-col items-center space-y-4">
        {/* Spinner animation */}
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        
        {/* Loading message */}
        <div className="text-lg font-medium text-muted-foreground">
          {message}
        </div>
        
        {/* Progress bar and info */}
        {progress && (
          <div className="w-full max-w-md space-y-2">
            <div className="w-full bg-secondary rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
            
            <div className="text-sm text-muted-foreground">
              {progress.loaded} / {progress.total} images loaded ({progressPercentage}%)
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}