import type { CanvasHTMLAttributes, ReactNode, RefObject } from 'react';
import { cn } from '@/lib/utils';

interface PrimaryViewportProps {
  canvasRef: RefObject<HTMLCanvasElement>;
  canvasProps: CanvasHTMLAttributes<HTMLCanvasElement>;
  className?: string;
  children?: ReactNode;
}

export function PrimaryViewport({ canvasRef, canvasProps, className, children }: PrimaryViewportProps) {
  return (
    <div className={cn('relative w-full h-full flex items-center justify-center', className)}>
      <canvas ref={canvasRef} {...canvasProps} />
      {children}
    </div>
  );
}
