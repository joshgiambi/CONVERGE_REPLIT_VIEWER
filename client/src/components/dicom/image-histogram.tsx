import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart3, X } from 'lucide-react';

interface ImageHistogramProps {
  imageData?: { data: Float32Array; width: number; height: number };
  windowLevel: { window: number; level: number };
  isVisible: boolean;
  onClose: () => void;
}

export function ImageHistogram({ imageData, windowLevel, isVisible, onClose }: ImageHistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [histogramData, setHistogramData] = useState<number[]>([]);
  const [stats, setStats] = useState<{
    min: number;
    max: number;
    mean: number;
    stdDev: number;
  } | null>(null);

  useEffect(() => {
    if (imageData && isVisible) {
      calculateHistogram();
    }
  }, [imageData, isVisible]);

  useEffect(() => {
    if (histogramData.length > 0 && isVisible) {
      drawHistogram();
    }
  }, [histogramData, windowLevel, isVisible]);

  const calculateHistogram = () => {
    if (!imageData) return;

    const { data } = imageData;
    const bins = 256;
    const histogram = new Array(bins).fill(0);
    
    // Find min and max values
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    
    const mean = sum / data.length;
    
    // Calculate standard deviation
    let variance = 0;
    for (let i = 0; i < data.length; i++) {
      variance += Math.pow(data[i] - mean, 2);
    }
    const stdDev = Math.sqrt(variance / data.length);
    
    // Build histogram
    const range = max - min;
    for (let i = 0; i < data.length; i++) {
      const binIndex = Math.floor(((data[i] - min) / range) * (bins - 1));
      histogram[binIndex]++;
    }
    
    setHistogramData(histogram);
    setStats({ min, max, mean, stdDev });
  };

  const drawHistogram = () => {
    if (!canvasRef.current || histogramData.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    
    // Find max frequency for scaling
    const maxFreq = Math.max(...histogramData);
    
    // Draw histogram bars
    const barWidth = width / histogramData.length;
    ctx.fillStyle = '#00ff00';
    
    histogramData.forEach((freq, index) => {
      const barHeight = (freq / maxFreq) * (height - 40);
      const x = index * barWidth;
      const y = height - barHeight - 20;
      
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    });
    
    // Draw window/level indicators
    if (stats) {
      const range = stats.max - stats.min;
      const windowMin = windowLevel.level - windowLevel.window / 2;
      const windowMax = windowLevel.level + windowLevel.window / 2;
      
      // Convert to canvas coordinates
      const minX = ((windowMin - stats.min) / range) * width;
      const maxX = ((windowMax - stats.min) / range) * width;
      
      // Draw window range
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(minX, 0);
      ctx.lineTo(minX, height - 20);
      ctx.moveTo(maxX, 0);
      ctx.lineTo(maxX, height - 20);
      ctx.stroke();
      
      // Draw level line
      const levelX = ((windowLevel.level - stats.min) / range) * width;
      ctx.strokeStyle = '#ff0000';
      ctx.beginPath();
      ctx.moveTo(levelX, 0);
      ctx.lineTo(levelX, height - 20);
      ctx.stroke();
    }
    
    // Draw labels
    ctx.fillStyle = '#fff';
    ctx.font = '10px Arial';
    ctx.textAlign = 'left';
    
    if (stats) {
      ctx.fillText(`Min: ${stats.min.toFixed(1)}`, 5, height - 5);
      ctx.fillText(`Max: ${stats.max.toFixed(1)}`, width - 80, height - 5);
      ctx.fillText(`Mean: ${stats.mean.toFixed(1)}`, 5, 15);
      ctx.fillText(`StdDev: ${stats.stdDev.toFixed(1)}`, width - 100, 15);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 right-4 z-40">
      <Card className="bg-black/90 border-green-500/50 p-4 w-80">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center">
            <BarChart3 className="w-4 h-4 mr-2 text-green-400" />
            <h3 className="text-green-300 font-semibold">Image Histogram</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        
        <canvas
          ref={canvasRef}
          width={280}
          height={150}
          className="w-full border border-gray-600 rounded"
        />
        
        <div className="mt-3 text-xs text-gray-300 space-y-1">
          <div className="flex justify-between">
            <span>Window: {windowLevel.window}</span>
            <span>Level: {windowLevel.level}</span>
          </div>
          <div className="text-gray-500">
            <span className="text-yellow-400">■</span> Window Range
            <span className="ml-2 text-red-400">■</span> Level
          </div>
        </div>
      </Card>
    </div>
  );
}