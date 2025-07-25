/**
 * Centralized Clipper library adapter
 * Ensures consistent WASM instance usage across all boolean operations
 */

import * as Clipper from 'js-angusj-clipper';

export type ClipperAPI = {
  instance: any;
  Path: any;
  Paths: any;
  Clipper: any;
  PolyType: any;
  ClipType: any;
  PolyFillType: any;
  CleanPolygon: (path: any, dist: number) => any;
  CleanPolygons: (paths: any, dist: number) => any;
  SimplifyPolygon: (path: any, fillType: any) => any;
  SimplifyPolygons: (paths: any, fillType: any) => any;
  ClipperOffset?: any;
  IoManager: any;
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
      CleanPolygon: lib.instance.CleanPolygon,
      CleanPolygons: lib.instance.CleanPolygons,
      SimplifyPolygon: lib.instance.SimplifyPolygon,
      SimplifyPolygons: lib.instance.SimplifyPolygons,
      ClipperOffset: lib.instance.ClipperOffset,
      IoManager: lib.instance.IoManager,
    };
    
    return api;
  } catch (error) {
    console.error('Failed to load Clipper WASM:', error);
    throw error;
  }
}

// Helper to create a new Clipper instance with IoManager
export async function createClipperInstance() {
  const api = await getClipper();
  return new api.Clipper(new api.IoManager());
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