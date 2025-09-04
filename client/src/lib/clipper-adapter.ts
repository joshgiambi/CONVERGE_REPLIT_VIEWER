/**
 * Centralized Clipper library adapter
 * Ensures consistent WASM instance usage across all boolean operations
 */

// @ts-ignore
import * as Clipper from 'js-angusj-clipper';

export type ClipperAPI = {
  instance: any;
  Path: any;
  Paths: any;
  Clipper: any;
  PolyType: any;
  ClipType: any;
  PolyFillType: any;
  JoinType: any;
  EndType: any;
  cleanPolygon: (path: any, dist: number) => any;
  cleanPolygons: (paths: any, dist: number) => any;
  simplifyPolygon: (path: any, fillType: any) => any;
  simplifyPolygons: (paths: any, fillType: any) => any;
  ClipperOffset?: any;
  pointInPolygon: (pt: any, path: any) => number;
  IntPoint?: any;
  // Back-compat PascalCase aliases used elsewhere
  CleanPolygon?: (path: any, dist: number) => any;
  CleanPolygons?: (paths: any, dist: number) => any;
  SimplifyPolygon?: (path: any, fillType: any) => any;
  SimplifyPolygons?: (paths: any, fillType: any) => any;
  PointInPolygon?: (pt: any, path: any) => number;
};

let cached: ClipperAPI | null = null;
let initPromise: Promise<ClipperAPI> | null = null;

export async function getClipper(): Promise<ClipperAPI> {
  if (cached) return cached;
  
  // Prevent multiple simultaneous initializations
  if (initPromise) return initPromise;
  
  initPromise = loadClipperInstance();
  cached = await initPromise;
  return cached;
}

async function loadClipperInstance(): Promise<ClipperAPI> {
  try {
    console.log('Loading Clipper WASM instance...');
    const lib = await Clipper.loadNativeClipperLibInstanceAsync(
      Clipper.NativeClipperLibRequestedFormat.WasmWithAsmJsFallback
    );
    
    console.log('Clipper WASM loaded successfully');
    
    const api: ClipperAPI = {
      instance: lib.instance,
      Path: lib.instance.Path,
      Paths: lib.instance.Paths,
      Clipper: lib.instance.Clipper,
      PolyType: lib.instance.PolyType,
      ClipType: lib.instance.ClipType,
      PolyFillType: lib.instance.PolyFillType,
      JoinType: lib.instance.JoinType,
      EndType: lib.instance.EndType,
      cleanPolygon: lib.instance.cleanPolygon,
      cleanPolygons: lib.instance.cleanPolygons,
      simplifyPolygon: lib.instance.simplifyPolygon as any,
      simplifyPolygons: (lib.instance as any).simplifyPolygons ?? (lib.instance.simplifyPolygon as any),
      ClipperOffset: lib.instance.ClipperOffset,
      pointInPolygon: lib.instance.pointInPolygon,
      IntPoint: lib.instance.IntPoint,
    } as any;

    // Back-compat shim: expose PascalCase aliases for older codepaths
    (api as any).CleanPolygon = (api as any).cleanPolygon;
    (api as any).CleanPolygons = (api as any).cleanPolygons;
    (api as any).SimplifyPolygon = (api as any).simplifyPolygon;
    (api as any).SimplifyPolygons = (api as any).simplifyPolygons;
    (api as any).PointInPolygon = (api as any).pointInPolygon;
    (api as any).IntPoint = (api as any).IntPoint;

    return api;
  } catch (error) {
    console.error('Failed to load Clipper WASM:', error);
    throw error;
  }
}

// Helper to create a new Clipper instance with IoManager
export async function createClipperInstance() {
  const api = await getClipper();
  return new api.Clipper(0); // 0 = default initialization options
}

// Helper to create new Path
export async function createPath() {
  const api = await getClipper();
  return new api.Path();
}

// Helper to create new Paths
export async function createPaths() {
  const api = await getClipper();
  return new api.Paths();
}

// Helper to create new ClipperOffset
export async function createClipperOffset(miterLimit = 2.0, arcTolerance = 0.25) {
  const api = await getClipper();
  return new api.ClipperOffset(miterLimit, arcTolerance);
}