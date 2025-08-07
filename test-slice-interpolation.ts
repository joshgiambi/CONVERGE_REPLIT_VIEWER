#!/usr/bin/env node

// Verify Z-slice interpolation positions
import assert from 'node:assert/strict';
import { interpolateContours } from './client/src/lib/contour-prediction';

// Two simple square contours at z=0 and z=10
const contourA = [
  0, 0, 0,
  10, 0, 0,
  10, 10, 0,
  0, 10, 0
];

const contourB = [
  0, 0, 10,
  10, 0, 10,
  10, 10, 10,
  0, 10, 10
];

const interpolated = interpolateContours(contourA, contourB, 0, 10, 5);

// Extract z values
const zValues = [] as number[];
for (let i = 2; i < interpolated.length; i += 3) {
  zValues.push(interpolated[i]);
}

assert(zValues.every(z => Math.abs(z - 5) < 1e-6), `Unexpected z-values: ${zValues}`);
console.log('✓ Z-slice interpolation produces correct slice position');
