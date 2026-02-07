declare module 'yauzl';
declare module 'fluent-ffmpeg';
declare module 'archiver';

// Vite raw imports for WebGPU shaders
declare module '*.wgsl?raw' {
  const content: string;
  export default content;
}

