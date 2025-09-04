// Margin worker: runs DT-based margins off the main thread
import { contoursToStructure, structureToContours } from './adapters';
import { marginSymmetric, marginAsymmetric } from './margin';

type Kind = 'UNIFORM' | 'DIRECTIONAL' | 'ANISOTROPIC';

interface JobPayload {
  jobId: string;
  kind: Kind;
  contours: Array<{ points: number[]; slicePosition: number }>;
  spacing: [number, number, number];
  padding: number;
  // For uniform
  margin?: number;
  // For directional
  perSide?: { post: number; ant: number; left: number; right: number; sup: number; inf: number };
}

self.onmessage = (e: MessageEvent<JobPayload>) => {
  (async () => {
    const data = e.data;
    try {
      const structure = contoursToStructure(data.contours, data.spacing, data.padding);
      let out;
      switch (data.kind) {
        case 'UNIFORM':
          out = marginSymmetric(structure, data.margin || 0, true);
          break;
        case 'DIRECTIONAL':
          out = marginAsymmetric(structure, true, data.perSide || { post: 0, ant: 0, left: 0, right: 0, sup: 0, inf: 0 }, true);
          break;
        case 'ANISOTROPIC':
          // Map anisotropic x/y/z to equal per-side values
          const m = data.perSide || { post: 0, ant: 0, left: 0, right: 0, sup: 0, inf: 0 };
          out = marginAsymmetric(structure, true, m, true);
          break;
      }
      const resultContours = structureToContours(out.mask, data.contours.map(c => c.slicePosition), undefined, true);
      // Post back results
      // @ts-ignore
      self.postMessage({ jobId: data.jobId, ok: true, contours: resultContours });
    } catch (err) {
      // @ts-ignore
      self.postMessage({ jobId: data.jobId, ok: false, error: String(err) });
    }
  })();
};

export {};


