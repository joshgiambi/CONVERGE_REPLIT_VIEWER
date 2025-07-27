/**
 * GPU-Accelerated Volume Renderer for MPR
 * 
 * This module implements OHIF3/Cornerstone3D-style GPU volume rendering
 * for significantly improved performance in MPR views.
 */

import { DICOMLoader } from './dicom-loader';

export interface VolumeData {
  dimensions: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  direction: Float32Array;
  pixelData: Float32Array;
  windowWidth: number;
  windowCenter: number;
}

export interface GPUVolume {
  texture: WebGLTexture;
  dimensions: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
}

export class GPUVolumeRenderer {
  private gl: WebGL2RenderingContext;
  private volumeTexture: WebGLTexture | null = null;
  private shaderProgram: WebGLProgram | null = null;
  private volumeData: VolumeData | null = null;
  private frameBuffer: WebGLFramebuffer | null = null;
  private renderTexture: WebGLTexture | null = null;
  
  // Shader sources for volume rendering
  private vertexShaderSource = `#version 300 es
    in vec3 a_position;
    in vec3 a_texCoord;
    
    uniform mat4 u_matrix;
    
    out vec3 v_texCoord;
    
    void main() {
      gl_Position = u_matrix * vec4(a_position, 1.0);
      v_texCoord = a_texCoord;
    }
  `;
  
  private fragmentShaderSource = `#version 300 es
    precision highp float;
    precision highp sampler3D;
    
    in vec3 v_texCoord;
    
    uniform sampler3D u_volume;
    uniform float u_windowWidth;
    uniform float u_windowCenter;
    uniform vec3 u_sliceNormal;
    uniform float u_sliceDistance;
    
    out vec4 fragColor;
    
    void main() {
      // Sample the 3D volume texture
      float value = texture(u_volume, v_texCoord).r;
      
      // Apply window/level
      float windowMin = u_windowCenter - u_windowWidth * 0.5;
      float windowMax = u_windowCenter + u_windowWidth * 0.5;
      value = clamp((value - windowMin) / (windowMax - windowMin), 0.0, 1.0);
      
      fragColor = vec4(value, value, value, 1.0);
    }
  `;
  
  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    
    if (!context) {
      throw new Error('WebGL2 not supported');
    }
    
    this.gl = context;
    this.initShaders();
  }
  
  private initShaders() {
    const gl = this.gl;
    
    // Create vertex shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) throw new Error('Failed to create vertex shader');
    
    gl.shaderSource(vertexShader, this.vertexShaderSource);
    gl.compileShader(vertexShader);
    
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      throw new Error('Vertex shader compilation failed: ' + gl.getShaderInfoLog(vertexShader));
    }
    
    // Create fragment shader
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) throw new Error('Failed to create fragment shader');
    
    gl.shaderSource(fragmentShader, this.fragmentShaderSource);
    gl.compileShader(fragmentShader);
    
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      throw new Error('Fragment shader compilation failed: ' + gl.getShaderInfoLog(fragmentShader));
    }
    
    // Create shader program
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create shader program');
    
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Shader program linking failed: ' + gl.getProgramInfoLog(program));
    }
    
    this.shaderProgram = program;
  }
  
  /**
   * Load volume data from DICOM images into GPU memory
   */
  async loadVolume(imageIds: string[], progressCallback?: (percent: number) => void): Promise<GPUVolume> {
    const gl = this.gl;
    
    // Load first image to get dimensions
    const loader = DICOMLoader.getInstance();
    const firstCanvas = await loader.loadDICOMImage(imageIds[0].replace('/api/images/', ''));
    const width = firstCanvas.width;
    const height = firstCanvas.height;
    const depth = imageIds.length;
    
    // Create 3D texture
    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to create 3D texture');
    
    gl.bindTexture(gl.TEXTURE_3D, texture);
    
    // Set texture parameters for medical imaging
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    
    // Allocate texture memory
    gl.texImage3D(
      gl.TEXTURE_3D,
      0, // level
      gl.R32F, // internal format
      width,
      height,
      depth,
      0, // border
      gl.RED, // format
      gl.FLOAT, // type
      null // no data yet
    );
    
    // Load slices progressively
    for (let i = 0; i < imageIds.length; i++) {
      const canvas = await loader.loadDICOMImage(imageIds[i].replace('/api/images/', ''));
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const imageData = ctx.getImageData(0, 0, width, height);
      const pixelData = new Float32Array(imageData.data.length / 4);
      
      // Convert RGBA to single channel float
      for (let j = 0; j < pixelData.length; j++) {
        pixelData[j] = imageData.data[j * 4] / 255.0;
      }
      
      // Upload slice to 3D texture
      gl.texSubImage3D(
        gl.TEXTURE_3D,
        0, // level
        0, // xoffset
        0, // yoffset
        i, // zoffset
        width,
        height,
        1, // depth (single slice)
        gl.RED,
        gl.FLOAT,
        pixelData
      );
      
      if (progressCallback) {
        progressCallback((i + 1) / imageIds.length * 100);
      }
    }
    
    this.volumeTexture = texture;
    
    // Store volume metadata - using default values for now
    // In a real implementation, we would extract this from DICOM metadata
    this.volumeData = {
      dimensions: [width, height, depth],
      spacing: [1, 1, 1], // Default spacing - would extract from DICOM
      origin: [0, 0, 0], // Default origin - would extract from DICOM
      direction: new Float32Array([1, 0, 0, 0, 1, 0]), // Default orientation
      pixelData: new Float32Array(0), // Not stored in CPU memory for GPU renderer
      windowWidth: 400, // Default window width
      windowCenter: 40 // Default window center
    };
    
    return {
      texture,
      dimensions: this.volumeData.dimensions,
      spacing: this.volumeData.spacing,
      origin: this.volumeData.origin
    };
  }
  
  /**
   * Render an MPR slice from the volume
   */
  renderMPRSlice(
    orientation: 'axial' | 'sagittal' | 'coronal',
    sliceIndex: number,
    windowWidth: number,
    windowCenter: number,
    outputCanvas: HTMLCanvasElement
  ) {
    if (!this.volumeData || !this.volumeTexture || !this.shaderProgram) {
      throw new Error('Volume not loaded');
    }
    
    const gl = this.gl;
    const program = this.shaderProgram;
    
    // Use shader program
    gl.useProgram(program);
    
    // Bind volume texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);
    
    const volumeLocation = gl.getUniformLocation(program, 'u_volume');
    gl.uniform1i(volumeLocation, 0);
    
    // Set window/level
    const windowWidthLocation = gl.getUniformLocation(program, 'u_windowWidth');
    const windowCenterLocation = gl.getUniformLocation(program, 'u_windowCenter');
    gl.uniform1f(windowWidthLocation, windowWidth);
    gl.uniform1f(windowCenterLocation, windowCenter);
    
    // Create quad geometry for the slice
    const positions = this.getSliceGeometry(orientation, sliceIndex);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    
    // Create texture coordinates
    const texCoords = this.getSliceTexCoords(orientation, sliceIndex);
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    
    const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 3, gl.FLOAT, false, 0, 0);
    
    // Set viewport
    gl.viewport(0, 0, outputCanvas.width, outputCanvas.height);
    
    // Clear and render
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    // Copy to output canvas
    const outputCtx = outputCanvas.getContext('2d');
    if (outputCtx) {
      outputCtx.drawImage(this.gl.canvas, 0, 0);
    }
  }
  
  private getSliceGeometry(orientation: string, sliceIndex: number): Float32Array {
    // Return quad vertices for the slice
    const positions = new Float32Array([
      -1, -1, 0,
       1, -1, 0,
      -1,  1, 0,
       1,  1, 0
    ]);
    
    return positions;
  }
  
  private getSliceTexCoords(orientation: string, sliceIndex: number): Float32Array {
    if (!this.volumeData) return new Float32Array(12);
    
    const [width, height, depth] = this.volumeData.dimensions;
    
    let coords: Float32Array;
    
    switch (orientation) {
      case 'axial':
        const z = sliceIndex / depth;
        coords = new Float32Array([
          0, 0, z,
          1, 0, z,
          0, 1, z,
          1, 1, z
        ]);
        break;
        
      case 'sagittal':
        const x = sliceIndex / width;
        coords = new Float32Array([
          x, 0, 0,
          x, 0, 1,
          x, 1, 0,
          x, 1, 1
        ]);
        break;
        
      case 'coronal':
        const y = sliceIndex / height;
        coords = new Float32Array([
          0, y, 0,
          1, y, 0,
          0, y, 1,
          1, y, 1
        ]);
        break;
        
      default:
        coords = new Float32Array(12);
    }
    
    return coords;
  }
  
  /**
   * Share volume texture across multiple viewports for memory efficiency
   */
  shareVolumeTexture(): WebGLTexture | null {
    return this.volumeTexture;
  }
  
  /**
   * Clean up GPU resources
   */
  dispose() {
    const gl = this.gl;
    
    if (this.volumeTexture) {
      gl.deleteTexture(this.volumeTexture);
    }
    
    if (this.shaderProgram) {
      gl.deleteProgram(this.shaderProgram);
    }
    
    if (this.frameBuffer) {
      gl.deleteFramebuffer(this.frameBuffer);
    }
    
    if (this.renderTexture) {
      gl.deleteTexture(this.renderTexture);
    }
  }
}

/**
 * Singleton GPU volume manager for sharing resources
 */
export class GPUVolumeManager {
  private static instance: GPUVolumeManager;
  private volumes: Map<string, GPUVolume> = new Map();
  private renderers: Map<string, GPUVolumeRenderer> = new Map();
  
  static getInstance(): GPUVolumeManager {
    if (!GPUVolumeManager.instance) {
      GPUVolumeManager.instance = new GPUVolumeManager();
    }
    return GPUVolumeManager.instance;
  }
  
  async loadVolume(
    volumeId: string,
    imageIds: string[],
    canvas: HTMLCanvasElement,
    progressCallback?: (percent: number) => void
  ): Promise<GPUVolume> {
    // Check if volume already loaded
    if (this.volumes.has(volumeId)) {
      return this.volumes.get(volumeId)!;
    }
    
    // Create renderer if needed
    if (!this.renderers.has(volumeId)) {
      this.renderers.set(volumeId, new GPUVolumeRenderer(canvas));
    }
    
    const renderer = this.renderers.get(volumeId)!;
    const volume = await renderer.loadVolume(imageIds, progressCallback);
    
    this.volumes.set(volumeId, volume);
    return volume;
  }
  
  getRenderer(volumeId: string): GPUVolumeRenderer | undefined {
    return this.renderers.get(volumeId);
  }
  
  dispose(volumeId: string) {
    const renderer = this.renderers.get(volumeId);
    if (renderer) {
      renderer.dispose();
      this.renderers.delete(volumeId);
    }
    this.volumes.delete(volumeId);
  }
}