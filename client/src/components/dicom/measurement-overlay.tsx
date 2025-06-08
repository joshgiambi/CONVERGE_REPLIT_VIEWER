import { useState, useRef, useEffect } from 'react';

interface Measurement {
  id: string;
  type: 'distance' | 'angle' | 'area';
  points: { x: number; y: number }[];
  value: number;
  unit: string;
}

interface MeasurementOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  pixelSpacing?: { x: number; y: number };
  isActive: boolean;
  measurementType: 'distance' | 'angle' | 'area';
  onMeasurementComplete?: (measurement: Measurement) => void;
}

export function MeasurementOverlay({ 
  canvasRef, 
  pixelSpacing = { x: 1, y: 1 }, 
  isActive, 
  measurementType,
  onMeasurementComplete 
}: MeasurementOverlayProps) {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [currentMeasurement, setCurrentMeasurement] = useState<Partial<Measurement> | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!overlayRef.current || !canvasRef.current) return;

    const overlay = overlayRef.current;
    const mainCanvas = canvasRef.current;
    
    // Match overlay canvas size to main canvas
    overlay.width = mainCanvas.width;
    overlay.height = mainCanvas.height;
    overlay.style.width = mainCanvas.style.width;
    overlay.style.height = mainCanvas.style.height;

    redrawMeasurements();
  }, [measurements, currentMeasurement]);

  const redrawMeasurements = () => {
    if (!overlayRef.current) return;
    
    const ctx = overlayRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    
    // Draw completed measurements
    measurements.forEach(measurement => {
      drawMeasurement(ctx, measurement, '#00ff00');
    });

    // Draw current measurement being created
    if (currentMeasurement && currentMeasurement.points && currentMeasurement.points.length > 0) {
      drawMeasurement(ctx, currentMeasurement as Measurement, '#ffff00');
    }
  };

  const drawMeasurement = (ctx: CanvasRenderingContext2D, measurement: Partial<Measurement>, color: string) => {
    if (!measurement.points || measurement.points.length === 0) return;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.font = '14px Arial';

    if (measurement.type === 'distance' && measurement.points.length >= 2) {
      // Draw line
      ctx.beginPath();
      ctx.moveTo(measurement.points[0].x, measurement.points[0].y);
      ctx.lineTo(measurement.points[1].x, measurement.points[1].y);
      ctx.stroke();

      // Draw measurement value
      const midX = (measurement.points[0].x + measurement.points[1].x) / 2;
      const midY = (measurement.points[0].y + measurement.points[1].y) / 2;
      
      if (measurement.value !== undefined) {
        ctx.fillText(`${measurement.value.toFixed(1)} ${measurement.unit}`, midX + 5, midY - 5);
      }

      // Draw endpoints
      measurement.points.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
  };

  const calculateDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }): number => {
    const dx = (p2.x - p1.x) * pixelSpacing.x;
    const dy = (p2.y - p1.y) * pixelSpacing.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isActive || !overlayRef.current) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (measurementType === 'distance') {
      if (!currentMeasurement) {
        // Start new measurement
        setCurrentMeasurement({
          id: Date.now().toString(),
          type: 'distance',
          points: [{ x, y }],
          unit: 'mm'
        });
        setIsDrawing(true);
      } else if (currentMeasurement.points && currentMeasurement.points.length === 1) {
        // Complete distance measurement
        const points = [...currentMeasurement.points, { x, y }];
        const distance = calculateDistance(points[0], points[1]);
        
        const completedMeasurement: Measurement = {
          id: currentMeasurement.id!,
          type: 'distance',
          points,
          value: distance,
          unit: 'mm'
        };

        setMeasurements(prev => [...prev, completedMeasurement]);
        setCurrentMeasurement(null);
        setIsDrawing(false);
        
        if (onMeasurementComplete) {
          onMeasurementComplete(completedMeasurement);
        }
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isActive || !isDrawing || !currentMeasurement || !overlayRef.current) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (measurementType === 'distance' && currentMeasurement.points && currentMeasurement.points.length === 1) {
      // Update second point for distance measurement
      const points = [currentMeasurement.points[0], { x, y }];
      const distance = calculateDistance(points[0], points[1]);
      
      setCurrentMeasurement({
        ...currentMeasurement,
        points,
        value: distance
      });
    }
  };

  const clearMeasurements = () => {
    setMeasurements([]);
    setCurrentMeasurement(null);
    setIsDrawing(false);
  };

  return (
    <div className="relative">
      <canvas
        ref={overlayRef}
        className="absolute top-0 left-0 pointer-events-auto"
        style={{ 
          zIndex: 10,
          cursor: isActive ? 'crosshair' : 'default'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      />
      
      {measurements.length > 0 && (
        <div className="absolute top-4 right-4 bg-black/80 text-white p-2 rounded text-sm">
          <div className="flex items-center justify-between mb-2">
            <span>Measurements</span>
            <button
              onClick={clearMeasurements}
              className="text-red-400 hover:text-red-300 ml-2"
            >
              Clear
            </button>
          </div>
          {measurements.map((measurement, index) => (
            <div key={measurement.id} className="text-xs">
              {index + 1}. {measurement.value.toFixed(1)} {measurement.unit}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}