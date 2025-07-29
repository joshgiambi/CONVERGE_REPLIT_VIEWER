/**
 * Viewer toolbar component - header section with slice navigation and info
 * Extracted from the monolithic WorkingViewer component
 */

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ViewerToolbarProps {
  currentIndex: number;
  totalImages: number;
  currentSlicePosition: number;
  windowLevel: { window: number; level: number };
  orientation: 'axial' | 'sagittal' | 'coronal';
  isLoading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onMPRToggle?: () => void;
  isMPRVisible?: boolean;
}

/**
 * Toolbar component for viewer navigation and information display
 */
export function ViewerToolbar({
  currentIndex,
  totalImages,
  currentSlicePosition,
  windowLevel,
  orientation,
  isLoading,
  onPrevious,
  onNext,
  onMPRToggle,
  isMPRVisible
}: ViewerToolbarProps) {
  const formatOrientation = (orient: string) => {
    return orient.charAt(0).toUpperCase() + orient.slice(1);
  };

  return (
    <Card className="p-3 mb-4">
      <div className="flex items-center justify-between">
        {/* Left side - Navigation */}
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onPrevious}
            disabled={currentIndex <= 0 || isLoading}
            className="px-2"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          
          <div className="text-sm font-medium min-w-[120px] text-center">
            {isLoading ? (
              <span className="text-muted-foreground">Loading...</span>
            ) : (
              <span>
                {currentIndex + 1} / {totalImages}
              </span>
            )}
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={onNext}
            disabled={currentIndex >= totalImages - 1 || isLoading}
            className="px-2"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Center - Title and slice info */}
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold">
            CT Scan - {formatOrientation(orientation)}
          </h3>
          
          {!isLoading && (
            <div className="flex items-center space-x-2">
              <Badge variant="secondary">
                Z: {currentSlicePosition.toFixed(1)}mm
              </Badge>
              
              <Badge variant="outline">
                W: {Math.round(windowLevel.window)} L: {Math.round(windowLevel.level)}
              </Badge>
            </div>
          )}
        </div>

        {/* Right side - Controls */}
        <div className="flex items-center space-x-2">
          {onMPRToggle && (
            <Button
              variant={isMPRVisible ? "default" : "outline"}
              size="sm"
              onClick={onMPRToggle}
              className="text-xs px-3"
            >
              MPR
            </Button>
          )}
          
          <div className="text-xs text-muted-foreground">
            {isLoading ? "Loading images..." : "Ready"}
          </div>
        </div>
      </div>
    </Card>
  );
}