/**
 * Error display component for DICOM viewer
 * Extracted from monolithic WorkingViewer component
 */

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorDisplayProps {
  error: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Error display with retry functionality
 */
export function ErrorDisplay({ 
  error, 
  onRetry,
  className = "" 
}: ErrorDisplayProps) {
  return (
    <Card className={`p-8 text-center border-red-200 bg-red-50 dark:bg-red-950 ${className}`}>
      <div className="flex flex-col items-center space-y-4">
        {/* Error icon */}
        <AlertCircle className="h-12 w-12 text-red-500" />
        
        {/* Error title */}
        <div className="text-lg font-semibold text-red-700 dark:text-red-300">
          Error Loading DICOM Data
        </div>
        
        {/* Error message */}
        <div className="text-sm text-red-600 dark:text-red-400 max-w-md">
          {error}
        </div>
        
        {/* Retry button */}
        {onRetry && (
          <Button 
            onClick={onRetry}
            variant="outline"
            className="mt-4 border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        )}
      </div>
    </Card>
  );
}