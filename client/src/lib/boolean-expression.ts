import { RTStructure, RTContour } from '@/components/dicom/rt-structure-overlay';
import { combineContours, subtractContours, intersectContours, xorContours } from './clipper-boolean-operations';

// Tokenize expression into structures and operators
function tokenize(expr: string): string[] {
  const tokens = expr.match(/[A-Za-z][A-Za-z0-9_#-]*|[∪∩⊕\-()]/g);
  return tokens ? tokens.map(t => t.trim()) : [];
}

const precedence: Record<string, number> = {
  '∩': 2,
  '-': 2,
  '∪': 1,
  '⊕': 1,
};

function toRPN(tokens: string[]): string[] {
  const output: string[] = [];
  const stack: string[] = [];
  for (const token of tokens) {
    if (/^[A-Za-z]/.test(token)) {
      output.push(token);
    } else if (token === '(') {
      stack.push(token);
    } else if (token === ')') {
      while (stack.length && stack[stack.length - 1] !== '(') {
        output.push(stack.pop()!);
      }
      stack.pop();
    } else {
      while (stack.length && precedence[stack[stack.length - 1]] >= precedence[token]) {
        output.push(stack.pop()!);
      }
      stack.push(token);
    }
  }
  while (stack.length) output.push(stack.pop()!);
  return output;
}

// Convert structures to map of slicePosition -> contours
function structureToMap(struct: RTStructure): Map<number, number[][]> {
  const map = new Map<number, number[][]>();
  for (const contour of struct.contours) {
    const arr = map.get(contour.slicePosition) || [];
    arr.push(contour.points);
    map.set(contour.slicePosition, arr);
  }
  return map;
}

async function unionAll(contours: number[][]): Promise<number[][]> {
  if (contours.length === 0) return [];
  let result: number[][] = [contours[0]];
  for (let i = 1; i < contours.length; i++) {
    const next = contours[i];
    const newResult: number[][] = [];
    for (const r of result) {
      const combined = await combineContours(r, next);
      newResult.push(...combined);
    }
    result = newResult.length ? newResult : result;
  }
  return result;
}

async function subtractAll(base: number[][], subtract: number[][]): Promise<number[][]> {
  let result: number[][] = await unionAll(base);
  for (const s of subtract) {
    const newResult: number[][] = [];
    for (const r of result) {
      const diff = await subtractContours(r, s);
      newResult.push(...diff);
    }
    result = newResult;
  }
  return result;
}

async function intersectAll(a: number[][], b: number[][]): Promise<number[][]> {
  const unionA = await unionAll(a);
  const unionB = await unionAll(b);
  const result: number[][] = [];
  for (const ca of unionA) {
    for (const cb of unionB) {
      const inter = await intersectContours(ca, cb);
      result.push(...inter);
    }
  }
  return result;
}

async function xorAll(a: number[][], b: number[][]): Promise<number[][]> {
  const unionA = await unionAll(a);
  const unionB = await unionAll(b);
  const result: number[][] = [];
  for (const ca of unionA) {
    for (const cb of unionB) {
      const x = await xorContours(ca, cb);
      result.push(...x);
    }
  }
  return result;
}

async function applyOp(op: string, a: Map<number, number[][]>, b: Map<number, number[][]>): Promise<Map<number, number[][]>> {
  const result = new Map<number, number[][]>();
  const slices = new Set<number>(
    Array.from(a.keys()).concat(Array.from(b.keys()))
  );
  for (const slice of Array.from(slices.values())) {
    const contoursA = a.get(slice) || [];
    const contoursB = b.get(slice) || [];
    let res: number[][] = [];
    switch (op) {
      case '∪':
        res = await unionAll([...contoursA, ...contoursB]);
        break;
      case '-':
        res = await subtractAll(contoursA, contoursB);
        break;
      case '∩':
        res = await intersectAll(contoursA, contoursB);
        break;
      case '⊕':
        res = await xorAll(contoursA, contoursB);
        break;
    }
    if (res.length) result.set(slice, res);
  }
  return result;
}

function mapToContours(map: Map<number, number[][]>): RTContour[] {
  const result: RTContour[] = [];
  for (const entry of Array.from(map.entries())) {
    const slice = entry[0];
    const contours = entry[1];
    for (const pts of contours) {
      result.push({ slicePosition: slice, points: pts, numberOfPoints: pts.length / 3 });
    }
  }
  return result;
}

export async function evaluateBooleanExpression(expression: string, structures: RTStructure[]): Promise<RTContour[]> {
  const tokens = tokenize(expression);
  const rpn = toRPN(tokens);
  const structMap: Map<string, Map<number, number[][]>> = new Map();
  for (const s of structures) {
    structMap.set(s.structureName.toLowerCase(), structureToMap(s));
  }
  const stack: Map<number, number[][]>[] = [];
  for (const token of rpn) {
    if (/^[A-Za-z]/.test(token)) {
      stack.push(structMap.get(token.toLowerCase()) || new Map());
    } else {
      const b = stack.pop() || new Map();
      const a = stack.pop() || new Map();
      stack.push(await applyOp(token, a, b));
    }
  }
  const finalMap = stack.pop() || new Map();
  return mapToContours(finalMap);
}
