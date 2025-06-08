import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, SkipBack, SkipForward, RotateCcw } from 'lucide-react';

interface CineControlsProps {
  totalImages: number;
  currentIndex: number;
  onImageChange: (index: number) => void;
  isVisible?: boolean;
}

export function CineControls({ 
  totalImages, 
  currentIndex, 
  onImageChange, 
  isVisible = true 
}: CineControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(10);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        onImageChange((prevIndex) => {
          if (direction === 'forward') {
            return prevIndex >= totalImages - 1 ? 0 : prevIndex + 1;
          } else {
            return prevIndex <= 0 ? totalImages - 1 : prevIndex - 1;
          }
        });
      }, 1000 / fps);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, fps, direction, totalImages, onImageChange]);

  const handlePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const handleStop = () => {
    setIsPlaying(false);
    onImageChange(0);
  };

  const handlePrevious = () => {
    setIsPlaying(false);
    onImageChange(Math.max(0, currentIndex - 1));
  };

  const handleNext = () => {
    setIsPlaying(false);
    onImageChange(Math.min(totalImages - 1, currentIndex + 1));
  };

  const handleDirectionToggle = () => {
    setDirection(prev => prev === 'forward' ? 'backward' : 'forward');
  };

  if (!isVisible || totalImages <= 1) return null;

  return (
    <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 z-40">
      <Card className="bg-black/80 backdrop-blur-sm border-gray-600 p-4">
        <div className="flex flex-col space-y-3">
          
          {/* Image Slider */}
          <div className="flex items-center space-x-3">
            <span className="text-white text-xs font-mono min-w-[60px]">
              {currentIndex + 1}/{totalImages}
            </span>
            <Slider
              value={[currentIndex]}
              onValueChange={(value) => {
                setIsPlaying(false);
                onImageChange(value[0]);
              }}
              max={totalImages - 1}
              step={1}
              className="flex-1 min-w-[200px]"
            />
          </div>

          {/* Playback Controls */}
          <div className="flex items-center justify-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleStop}
              className="text-white hover:text-yellow-400 p-1"
              title="Go to first image"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrevious}
              className="text-white hover:text-yellow-400 p-1"
              title="Previous image"
            >
              <SkipBack className="w-4 h-4" />
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePlay}
              className={`p-2 ${isPlaying ? 'text-red-400 hover:text-red-300' : 'text-green-400 hover:text-green-300'}`}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNext}
              className="text-white hover:text-yellow-400 p-1"
              title="Next image"
            >
              <SkipForward className="w-4 h-4" />
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDirectionToggle}
              className={`text-xs px-2 py-1 ${direction === 'forward' ? 'text-blue-400' : 'text-purple-400'}`}
              title="Toggle direction"
            >
              {direction === 'forward' ? '→' : '←'}
            </Button>
          </div>

          {/* Speed Control */}
          <div className="flex items-center space-x-2">
            <span className="text-white text-xs min-w-[30px]">FPS:</span>
            <Slider
              value={[fps]}
              onValueChange={(value) => setFps(value[0])}
              min={1}
              max={30}
              step={1}
              className="flex-1 min-w-[100px]"
            />
            <span className="text-white text-xs font-mono min-w-[20px]">{fps}</span>
          </div>
          
        </div>
      </Card>
    </div>
  );
}