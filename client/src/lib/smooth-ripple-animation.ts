/**
 * Border Glow Animation
 * Elegant expanding glow effect that pulses outward from contour border
 * Simple, beautiful visual feedback for smoothing operations
 */

export interface RippleAnimationState {
  structureId: number | null;
  startTime: number;
  duration: number;
}

export interface RippleRenderParams {
  ctx: CanvasRenderingContext2D;
  contourPoints: number[];
  structureColor: { r: number; g: number; b: number };
  baseOpacity: number;
  progress: number;
  imagePosition: number[];
  pixelSpacing: number[];
  imageX: number;
  imageY: number;
  totalScale: number;
}

/**
 * Apply elegant border glow animation
 * Soft expanding glow pulses outward from the border - clean and beautiful
 */
export function applyRippleAnimation(params: RippleRenderParams): boolean {
  const { 
    ctx, 
    contourPoints, 
    structureColor, 
    baseOpacity, 
    progress
  } = params;
  
  const { r, g, b } = structureColor;
  const greenR = 50, greenG = 255, greenB = 120; // Softer, more elegant green
  
  // Render normal fill (unchanged)
  ctx.fill();
  
  // Smooth easing
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  const easedProgress = easeOutCubic(progress);
  
  // Create expanding glow effect
  // Peak intensity in middle, fade in and out
  const intensityCurve = Math.sin(progress * Math.PI); // 0 → 1 → 0
  const glowStrength = intensityCurve * 0.85; // Max 85% intensity
  
  // Expanding shadow blur
  const maxBlur = 25; // Maximum blur radius
  const currentBlur = easedProgress * maxBlur;
  
  // Color mix - stronger at peak
  const greenMix = glowStrength * 0.6;
  const glowR = r * (1 - greenMix) + greenR * greenMix;
  const glowG = g * (1 - greenMix) + greenG * greenMix;
  const glowB = b * (1 - greenMix) + greenB * greenMix;
  
  // Draw border with expanding glow
  ctx.save();
  
  // Set shadow for glow effect
  ctx.shadowColor = `rgba(${greenR}, ${greenG}, ${greenB}, ${glowStrength * 0.8})`;
  ctx.shadowBlur = currentBlur;
  
  // Main border with green tint
  ctx.strokeStyle = `rgba(${glowR}, ${glowG}, ${glowB}, ${0.9 + glowStrength * 0.1})`;
  ctx.lineWidth = ctx.lineWidth * (1 + glowStrength * 0.4); // Slight thickening
  ctx.stroke();
  
  // Add second glow layer for extra softness (double shadow technique)
  if (glowStrength > 0.3) {
    ctx.shadowColor = `rgba(${greenR}, ${greenG}, ${greenB}, ${glowStrength * 0.4})`;
    ctx.shadowBlur = currentBlur * 1.5;
    ctx.stroke();
  }
  
  ctx.restore();
  
  return true;
}

/**
 * Create default animation state
 */
export function createDefaultAnimationState(): RippleAnimationState {
  return { structureId: null, startTime: 0, duration: 350 }; // Fast, snappy 350ms glow pulse
}

/**
 * Check if animation is active
 */
export function isAnimationActive(state: RippleAnimationState, structureId: number): boolean {
  return state.structureId === structureId;
}

/**
 * Get current animation progress (0-1)
 */
export function getAnimationProgress(state: RippleAnimationState): number {
  if (!state.structureId) return 0;
  return Math.min(1, (Date.now() - state.startTime) / state.duration);
}

