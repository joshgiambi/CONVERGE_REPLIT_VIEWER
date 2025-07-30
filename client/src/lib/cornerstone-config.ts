// Cornerstone3D configuration - using modern @cornerstonejs packages
import { init as initCore } from '@cornerstonejs/core';
import { init as initTools } from '@cornerstonejs/tools';
import dicomParser from 'dicom-parser';

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
      console.log('Starting Cornerstone3D initialization...');
      
      // Initialize Cornerstone3D Core and Tools
      await initCore();
      await initTools();

      // Make dicomParser available globally for compatibility
      (window as any).dicomParser = dicomParser;
      
      this.initialized = true;
      console.log('Cornerstone3D initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Cornerstone3D:', error);
      throw error;
    }
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}

export const cornerstoneConfig = CornerstoneConfig.getInstance();
