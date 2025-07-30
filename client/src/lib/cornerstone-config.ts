// Simplified Cornerstone.js configuration for DICOM rendering
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
      console.log('Initializing Cornerstone...');
      
      // Load Cornerstone libraries dynamically
      await this.loadScripts();
      
      const { cornerstone, cornerstoneTools, cornerstoneWADOImageLoader, dicomParser } = window;

      if (!cornerstone || !cornerstoneTools || !cornerstoneWADOImageLoader || !dicomParser) {
        throw new Error('Failed to load required Cornerstone libraries');
      }

      // Initialize Cornerstone
      try {
        cornerstone.init();
      } catch (error) {
        console.warn('Cornerstone already initialized');
      }
      
      try {
        cornerstoneTools.init();
      } catch (error) {
        console.warn('Cornerstone tools already initialized');
      }

      // Configure WADO Image Loader
      cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
      cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

      // Configure web workers for better performance
      const config = {
        maxWebWorkers: Math.min(navigator.hardwareConcurrency || 2, 4), // Limit to 4 workers max
        startWebWorkersOnDemand: true,
        webWorkerTaskPaths: [],
        taskConfiguration: {
          decodeTask: {
            initializeCodecsOnStartup: false,
            strict: false
          }
        }
      };

      cornerstoneWADOImageLoader.webWorkerManager.initialize(config);

      // Configure image loader with optimized settings
      cornerstoneWADOImageLoader.configure({
        beforeSend: (xhr: XMLHttpRequest) => {
          xhr.setRequestHeader('Accept', 'application/dicom');
        },
        errorInterceptor: (error: any) => {
          console.warn('DICOM loading error:', error);
        }
      });

      // Register image loaders
      cornerstone.registerImageLoader('wadouri', cornerstoneWADOImageLoader.wadouri.loadImage);
      cornerstone.registerImageLoader('dicomweb', cornerstoneWADOImageLoader.wadouri.loadImage);

      this.initialized = true;
      console.log('Cornerstone initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Cornerstone:', error);
      throw error;
    }
  }

  private async loadScripts(): Promise<void> {
    const scripts = [
      '/node_modules/cornerstone-core/dist/cornerstone.min.js',
      '/node_modules/cornerstone-math/dist/cornerstoneMath.min.js',
      '/node_modules/cornerstone-tools/dist/cornerstoneTools.min.js',
      '/node_modules/cornerstone-web-image-loader/dist/cornerstoneWebImageLoader.min.js',
      '/node_modules/cornerstone-wado-image-loader/dist/cornerstoneWADOImageLoader.bundle.min.js',
      '/node_modules/dicom-parser/dist/dicomParser.min.js',
    ];

    await Promise.all(scripts.map(src => this.loadScript(src)));
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
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
