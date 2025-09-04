/// <reference lib="webworker" />
import { union as vipUnion, intersect as vipIntersect, subtract as vipSubtract } from './vipBoolean';
import { unionMask, intersectMask, subtractMask } from './maskBoolean';
import type { VIPStructure, MaskStructure, BooleanOp } from './types';

type Backend = 'vip' | 'mask';

interface JobMessage {
  jobId: string;
  op: BooleanOp;
  backend: Backend;
  a: any;
  b: any;
}

interface ResultMessage {
  jobId: string;
  ok: true;
  backend: Backend;
  result: any;
}

interface ErrorMessage {
  jobId: string;
  ok: false;
  error: string;
}

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (evt: MessageEvent<JobMessage>) => {
  const { jobId, op, backend, a, b } = evt.data || ({} as JobMessage);
  try {
    if (backend === 'vip') {
      const A = a as VIPStructure;
      const B = b as VIPStructure;
      let result: VIPStructure;
      if (op === 'union') result = vipUnion(A, B);
      else if (op === 'intersect') result = vipIntersect(A, B);
      else result = vipSubtract(A, B);
      const msg: ResultMessage = { jobId, ok: true, backend, result };
      self.postMessage(msg);
      return;
    }
    if (backend === 'mask') {
      const A = a as MaskStructure;
      const B = b as MaskStructure;
      let result: MaskStructure;
      if (op === 'union') result = unionMask(A, B);
      else if (op === 'intersect') result = intersectMask(A, B);
      else result = subtractMask(A, B);
      const msg: ResultMessage = { jobId, ok: true, backend, result };
      self.postMessage(msg);
      return;
    }
    throw new Error(`Unknown backend: ${backend}`);
  } catch (err) {
    const msg: ErrorMessage = { jobId, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(msg);
  }
};


