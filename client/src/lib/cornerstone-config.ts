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
      console.log('Starting Cornerstone initialization...');
      
      // Load Cornerstone libraries dynamically
      await this.loadScripts();
      
      console.log('Scripts loaded, checking window objects...');
      console.log('cornerstone:', !!window.cornerstone);
      console.log('cornerstoneTools:', !!window.cornerstoneTools);
      console.log('cornerstoneWADOImageLoader:', !!window.cornerstoneWADOImageLoader);
      console.log('dicomParser:', !!window.dicomParser);
      
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
      console.log('Initializing cornerstone...');
      try {
        cornerstone.init();
        console.log('Cornerstone initialized');
      } catch (csError) {
        console.error('Cornerstone init error:', csError);
        // Cornerstone might already be initialized
      }
      
      console.log('Initializing cornerstone tools...');
      try {
        cornerstoneTools.init();
        console.log('Cornerstone tools initialized');
      } catch (ctError) {
        console.error('Cornerstone tools init error:', ctError);
        // Tools might already be initialized
      }

      // Configure WADO Image Loader
      console.log('Configuring WADO Image Loader...');
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

      console.log('Initializing web worker manager...');
      cornerstoneWADOImageLoader.webWorkerManager.initialize(config);
      console.log('Web worker manager initialized');

      // Register image loaders
      console.log('Configuring image loaders...');
      cornerstoneWADOImageLoader.configure({
        beforeSend: (xhr: XMLHttpRequest) => {
          xhr.setRequestHeader('Accept', 'application/dicom');
        },
        errorInterceptor: (error: any) => {
          console.warn('DICOM loading error:', error);
        }
      });

      // Register image loader for DICOM files
      console.log('Registering image loaders...');
      cornerstone.registerImageLoader('wadouri', cornerstoneWADOImageLoader.wadouri.loadImage);
      cornerstone.registerImageLoader('dicomweb', cornerstoneWADOImageLoader.wadouri.loadImage);

      this.initialized = true;
      console.log('Cornerstone initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Cornerstone:', error);
      console.error('Error details:', error);
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
