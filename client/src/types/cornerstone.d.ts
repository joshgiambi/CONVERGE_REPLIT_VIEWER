declare module 'cornerstone-core' {
  export interface Image {
    imageId: string;
    minPixelValue: number;
    maxPixelValue: number;
    slope: number;
    intercept: number;
    windowCenter: number;
    windowWidth: number;
    getPixelData: () => ArrayLike<number>;
    rows: number;
    columns: number;
    width: number;
    height: number;
    color: boolean;
    rgba: boolean;
    columnPixelSpacing: number;
    rowPixelSpacing: number;
  }

  export interface Viewport {
    scale?: number;
    translation?: { x: number; y: number };
    voi?: {
      windowWidth: number;
      windowCenter: number;
    };
    pixelReplication?: boolean;
    rotation?: number;
    hflip?: boolean;
    vflip?: boolean;
  }

  export function enable(element: HTMLElement): void;
  export function disable(element: HTMLElement): void;
  export function displayImage(element: HTMLElement, image: Image): void;
  export function loadImage(imageId: string): Promise<Image>;
  export function setViewport(element: HTMLElement, viewport: Viewport): void;
  export function getViewport(element: HTMLElement): Viewport;
  export function reset(element: HTMLElement): void;
  export function resize(element: HTMLElement, forceFitToWindow?: boolean): void;
}

declare module 'cornerstone-wado-image-loader' {
  export const external: {
    cornerstone: any;
    dicomParser: any;
  };

  export function configure(options: any): void;
  export const webWorkerManager: {
    initialize: (config: any) => void;
  };
}

declare module 'dicom-parser' {
  export interface DataSet {
    elements: any;
    byteArray: Uint8Array;
    string: (tag: string) => string;
    uint16: (tag: string) => number;
    uint32: (tag: string) => number;
    float: (tag: string) => number;
  }

  export function parseDicom(byteArray: Uint8Array): DataSet;
}