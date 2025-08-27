// Cornerstone.js configuration for DICOM rendering
// Note: Cornerstone3D adapter is available at ./cornerstone3d-adapter.ts
// Set ENABLE_CORNERSTONE3D to true to gradually migrate to GPU-accelerated rendering
import { isGPUAccelerationAvailable } from './cornerstone3d-adapter';

declare global {
  interface Window {
    cornerstone: any;
    cornerstoneTools: any;
    cornerstoneWADOImageLoader: any;
    dicomParser: any;
  }
}

export class CornerstoneConfig {
  private static instance: CornerstoneConfig;
  private initialized = false;

  static getInstance(): CornerstoneConfig {
    if (!CornerstoneConfig.instance) {
      CornerstoneConfig.instance = new CornerstoneConfig();
    }
    return CornerstoneConfig.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load Cornerstone libraries dynamically
      await this.loadScripts();
      
      const { cornerstone, cornerstoneTools, cornerstoneWADOImageLoader, dicomParser } = window;

      if (!cornerstone || !cornerstoneTools || !cornerstoneWADOImageLoader || !dicomParser) {
        const missing = [];
        if (!cornerstone) missing.push('cornerstone');
        if (!cornerstoneTools) missing.push('cornerstoneTools');
        if (!cornerstoneWADOImageLoader) missing.push('cornerstoneWADOImageLoader');
        if (!dicomParser) missing.push('dicomParser');
        throw new Error(`Failed to load Cornerstone libraries: ${missing.join(', ')}`);
      }

      // Initialize Cornerstone
      try {
        cornerstone.init();
      } catch (csError) {
        // Cornerstone might already be initialized
        // Cornerstone might already be initialized
      }

      try {
        cornerstoneTools.init();
      } catch (ctError) {
        // Tools might already be initialized
      }

      // Configure WADO Image Loader
      cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
      cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

      // Configure web workers
      const config = {
        maxWebWorkers: navigator.hardwareConcurrency || 1,
        startWebWorkersOnDemand: true,
        webWorkerPath: '/@fs/home/runner/workspace/node_modules/cornerstone-wado-image-loader/dist/index.worker.bundle.min.worker.js',
        webWorkerTaskPaths: [],
        taskConfiguration: {
          decodeTask: {
            initializeCodecsOnStartup: false,
            strict: false
          }
        }
      };

      cornerstoneWADOImageLoader.webWorkerManager.initialize(config);

      // Register image loaders
      cornerstoneWADOImageLoader.configure({
        beforeSend: (xhr: XMLHttpRequest) => {
          xhr.setRequestHeader('Accept', 'application/dicom');
        },
        errorInterceptor: (error: any) => {
          // no-op
        }
      });

      // Register image loader for DICOM files
      cornerstone.registerImageLoader('wadouri', cornerstoneWADOImageLoader.wadouri.loadImage);
      cornerstone.registerImageLoader('dicomweb', cornerstoneWADOImageLoader.wadouri.loadImage);

      this.initialized = true;
    } catch (error) {
      // Surface minimal error to console in case of fatal init failure
      console.error('Failed to initialize Cornerstone');
      throw error;
    }
  }

  private async loadScripts(): Promise<void> {
    const scripts = [
      '/@fs/home/runner/workspace/node_modules/cornerstone-core/dist/cornerstone.min.js',
      '/@fs/home/runner/workspace/node_modules/cornerstone-math/dist/cornerstoneMath.min.js',
      '/@fs/home/runner/workspace/node_modules/cornerstone-tools/dist/cornerstoneTools.min.js',
      '/@fs/home/runner/workspace/node_modules/cornerstone-web-image-loader/dist/cornerstoneWebImageLoader.min.js',
      '/@fs/home/runner/workspace/node_modules/cornerstone-wado-image-loader/dist/cornerstoneWADOImageLoader.bundle.min.js',
      '/@fs/home/runner/workspace/node_modules/dicom-parser/dist/dicomParser.min.js',
    ];

    for (const src of scripts) {
      await this.loadScript(src);
    }
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if script is already loaded
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  getCornerstone() {
    if (!this.initialized) {
      throw new Error('Cornerstone not initialized. Call initialize() first.');
    }
    return window.cornerstone;
  }

  getCornerstoneTools() {
    if (!this.initialized) {
      throw new Error('Cornerstone not initialized. Call initialize() first.');
    }
    return window.cornerstoneTools;
  }

  getWADOImageLoader() {
    if (!this.initialized) {
      throw new Error('Cornerstone not initialized. Call initialize() first.');
    }
    return window.cornerstoneWADOImageLoader;
  }
}

export const cornerstoneConfig = CornerstoneConfig.getInstance();
