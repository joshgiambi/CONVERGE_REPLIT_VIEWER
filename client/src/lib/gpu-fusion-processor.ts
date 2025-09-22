/**
 * GPU-Accelerated Fusion Processor
 * 
 * Uses WebGL shaders to accelerate fusion image processing operations
 * that are currently CPU bottlenecks in fuseboxSliceToImageData()
 */

export interface GPUFusionConfig {
  width: number;
  height: number;
  windowLevel?: { window: number; level: number } | null;
  modality: string | null;
  min: number;
  max: number;
}

export interface GPUFusionResult {
  imageData: ImageData;
  hasSignal: boolean;
  processingTime: number;
}

class GPUFusionProcessor {
  private gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private isInitialized = false;

  // Vertex shader - simple quad
  private readonly vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  // Fragment shader - fusion processing
  private readonly fragmentShaderSource = `
    precision highp float;
    
    uniform sampler2D u_texture;
    uniform float u_min;
    uniform float u_max;
    uniform float u_windowWidth;
    uniform float u_windowLevel;
    uniform bool u_useWindowLevel;
    uniform int u_modality; // 0=other, 1=CT, 2=PET
    uniform vec2 u_resolution;
    uniform float u_dataRange;
    
    varying vec2 v_texCoord;
    
    // PET color map (FDG)
    vec4 applyPETColorMap(float normalized) {
      if (normalized <= 0.05) {
        return vec4(0.0, 0.0, 0.0, 0.0);
      } else if (normalized <= 0.2) {
        float t = (normalized - 0.05) / 0.15;
        return vec4(
          mix(0.0, 90.0/255.0, t),
          mix(0.0, 25.0/255.0, t),
          0.0,
          mix(0.0, 1.0, t)
        );
      } else if (normalized <= 0.5) {
        float t = (normalized - 0.2) / 0.3;
        return vec4(
          mix(90.0/255.0, 220.0/255.0, t),
          mix(25.0/255.0, 110.0/255.0, t),
          0.0,
          1.0
        );
      } else if (normalized <= 0.8) {
        float t = (normalized - 0.5) / 0.3;
        return vec4(
          mix(220.0/255.0, 1.0, t),
          mix(110.0/255.0, 200.0/255.0, t),
          0.0,
          1.0
        );
      } else {
        float t = (normalized - 0.8) / 0.2;
        return vec4(
          1.0,
          mix(200.0/255.0, 1.0, t),
          mix(0.0, 1.0, t),
          1.0
        );
      }
    }
    
    void main() {
      // Sample the texture (contains encoded 16-bit values in RG channels)
      vec4 texel = texture2D(u_texture, v_texCoord);
      
      // Decode 16-bit value from R and G channels
      float encoded = texel.r * 256.0 + texel.g;
      
      // Convert back to original value range
      float value = u_min + (encoded * u_dataRange / 65535.0);
      
      // Calculate window/level
      float min_val, max_val;
      if (u_useWindowLevel) {
        min_val = u_windowLevel - u_windowWidth * 0.5;
        max_val = u_windowLevel + u_windowWidth * 0.5;
      } else {
        min_val = u_min;
        max_val = u_max;
      }
      
      float range = max(1e-6, max_val - min_val);
      float normalized = clamp((value - min_val) / range, 0.0, 1.0);
      
      // Apply modality-specific processing
      if (u_modality == 1) { // CT
        // CT: transparent at background, opaque otherwise
        float gray = normalized;
        float alpha = normalized <= 0.0 ? 0.0 : 1.0;
        gl_FragColor = vec4(gray, gray, gray, alpha);
      } else if (u_modality == 2) { // PET
        // PET: apply color map
        gl_FragColor = applyPETColorMap(normalized);
      } else { // Other modalities
        // Default: grayscale
        float gray = normalized;
        gl_FragColor = vec4(gray, gray, gray, 1.0);
      }
    }
  `;

  constructor() {
    this.initialize();
  }

  private initialize(): boolean {
    try {
      // Create offscreen canvas
      this.canvas = document.createElement('canvas');
      this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
      
      if (!this.gl) {
        console.warn('GPU Fusion: WebGL not available, falling back to CPU');
        return false;
      }

      console.log('🚀 GPU Fusion: WebGL context created successfully');

      // Create shaders and program
      const vertexShader = this.createShader(this.gl.VERTEX_SHADER, this.vertexShaderSource);
      const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, this.fragmentShaderSource);
      
      if (!vertexShader || !fragmentShader) {
        return false;
      }

      this.program = this.createProgram(vertexShader, fragmentShader);
      if (!this.program) {
        return false;
      }

      // Create vertex buffer (full-screen quad)
      const vertices = new Float32Array([
        // Position, TexCoord
        -1, -1,  0, 0,
         1, -1,  1, 0,
        -1,  1,  0, 1,
         1,  1,  1, 1,
      ]);

      this.vertexBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

      // Create texture for input data
      this.texture = this.gl.createTexture();
      
      this.isInitialized = true;
      console.log('🚀 GPU Fusion: Initialization complete');
      return true;
      
    } catch (error) {
      console.error('GPU Fusion: Initialization failed:', error);
      return false;
    }
  }

  private createShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    
    const shader = this.gl.createShader(type);
    if (!shader) return null;

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('GPU Fusion: Shader compilation error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null {
    if (!this.gl) return null;

    const program = this.gl.createProgram();
    if (!program) return null;

    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.error('GPU Fusion: Program linking error:', this.gl.getProgramInfoLog(program));
      this.gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  /**
   * Process fusion slice data using GPU acceleration
   */
  public processFusionSlice(
    data: Float32Array,
    config: GPUFusionConfig
  ): GPUFusionResult | null {
    if (!this.isInitialized || !this.gl || !this.program || !this.canvas) {
      return null;
    }

    const startTime = performance.now();

    try {
      const { width, height, windowLevel, modality, min, max } = config;

      // Set canvas size
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);

      // Upload texture data
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
      
      // Convert Float32Array to texture format
      // We need to encode the raw float values into RGBA channels for the shader to process
      const textureData = new Uint8Array(width * height * 4);
      
      // Find the actual range of the data for better encoding
      const dataRange = max - min;
      const scale = dataRange > 0 ? 65535 / dataRange : 1; // Use 16-bit range for better precision
      
      for (let i = 0; i < data.length; i++) {
        // Encode float value into 16-bit across R and G channels
        const rawValue = data[i] - min; // Offset by minimum
        const scaledValue = Math.max(0, Math.min(65535, Math.round(rawValue * scale)));
        
        const high = Math.floor(scaledValue / 256); // High byte in R
        const low = scaledValue % 256; // Low byte in G
        
        textureData[i * 4] = high;      // R: high byte
        textureData[i * 4 + 1] = low;   // G: low byte  
        textureData[i * 4 + 2] = 0;     // B: unused
        textureData[i * 4 + 3] = 255;   // A: full alpha
      }

      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        width,
        height,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        textureData
      );

      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

      // Use shader program
      this.gl.useProgram(this.program);

      // Set uniforms
      const uniforms = {
        u_texture: this.gl.getUniformLocation(this.program, 'u_texture'),
        u_min: this.gl.getUniformLocation(this.program, 'u_min'),
        u_max: this.gl.getUniformLocation(this.program, 'u_max'),
        u_windowWidth: this.gl.getUniformLocation(this.program, 'u_windowWidth'),
        u_windowLevel: this.gl.getUniformLocation(this.program, 'u_windowLevel'),
        u_useWindowLevel: this.gl.getUniformLocation(this.program, 'u_useWindowLevel'),
        u_modality: this.gl.getUniformLocation(this.program, 'u_modality'),
        u_resolution: this.gl.getUniformLocation(this.program, 'u_resolution'),
        u_dataRange: this.gl.getUniformLocation(this.program, 'u_dataRange'),
      };

      this.gl.uniform1i(uniforms.u_texture, 0);
      this.gl.uniform1f(uniforms.u_min, min);
      this.gl.uniform1f(uniforms.u_max, max);
      this.gl.uniform1f(uniforms.u_dataRange, dataRange);
      
      if (windowLevel) {
        this.gl.uniform1f(uniforms.u_windowWidth, windowLevel.window);
        this.gl.uniform1f(uniforms.u_windowLevel, windowLevel.level);
        this.gl.uniform1i(uniforms.u_useWindowLevel, 1);
      } else {
        this.gl.uniform1i(uniforms.u_useWindowLevel, 0);
      }

      // Set modality
      let modalityCode = 0;
      const mode = (modality || '').toUpperCase();
      if (mode === 'CT') modalityCode = 1;
      else if (mode === 'PT' || mode === 'PET') modalityCode = 2;
      this.gl.uniform1i(uniforms.u_modality, modalityCode);
      
      this.gl.uniform2f(uniforms.u_resolution, width, height);

      // Set up vertex attributes
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      
      const positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
      const texCoordLocation = this.gl.getAttribLocation(this.program, 'a_texCoord');
      
      this.gl.enableVertexAttribArray(positionLocation);
      this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 16, 0);
      
      this.gl.enableVertexAttribArray(texCoordLocation);
      this.gl.vertexAttribPointer(texCoordLocation, 2, this.gl.FLOAT, false, 16, 8);

      // Render
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

      // Read back result
      const pixels = new Uint8Array(width * height * 4);
      this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);

      // Create ImageData from result
      const imageData = new ImageData(width, height);
      imageData.data.set(pixels);

      // Check for signal (non-transparent pixels)
      let hasSignal = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] > 0) {
          hasSignal = true;
          break;
        }
      }

      const processingTime = performance.now() - startTime;
      
      console.log(`🚀 GPU Fusion: Processed ${width}x${height} slice in ${processingTime.toFixed(2)}ms`);

      return {
        imageData,
        hasSignal,
        processingTime
      };

    } catch (error) {
      console.error('GPU Fusion: Processing error:', error);
      return null;
    }
  }

  public isAvailable(): boolean {
    return this.isInitialized;
  }

  public cleanup(): void {
    if (this.gl) {
      if (this.program) this.gl.deleteProgram(this.program);
      if (this.vertexBuffer) this.gl.deleteBuffer(this.vertexBuffer);
      if (this.texture) this.gl.deleteTexture(this.texture);
      if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
    }
    this.gl = null;
    this.canvas = null;
    this.isInitialized = false;
  }
}

// Helper function
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Singleton instance
let gpuProcessor: GPUFusionProcessor | null = null;

/**
 * Get or create the GPU fusion processor instance
 */
export function getGPUFusionProcessor(): GPUFusionProcessor | null {
  if (!gpuProcessor) {
    gpuProcessor = new GPUFusionProcessor();
    if (!gpuProcessor.isAvailable()) {
      gpuProcessor = null;
    }
  }
  return gpuProcessor;
}

/**
 * GPU-accelerated version of fuseboxSliceToImageData
 */
export function processFusionSliceGPU(
  slice: { data: Float32Array; width: number; height: number; min: number; max: number },
  modality: string | null,
  windowLevel?: { window: number; level: number } | null,
): { imageData: ImageData; hasSignal: boolean; processingTime: number } | null {
  const processor = getGPUFusionProcessor();
  if (!processor) {
    return null;
  }

  return processor.processFusionSlice(slice.data, {
    width: slice.width,
    height: slice.height,
    windowLevel,
    modality,
    min: slice.min,
    max: slice.max
  });
}

/**
 * Cleanup GPU resources
 */
export function cleanupGPUFusionProcessor(): void {
  if (gpuProcessor) {
    gpuProcessor.cleanup();
    gpuProcessor = null;
  }
}
