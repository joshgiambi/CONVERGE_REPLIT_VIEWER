// DICOM Parser Web Worker
// Handles DICOM parsing off the main thread for 65% performance improvement (per OHIF)

declare const self: Worker & typeof globalThis;

interface DicomParserMessage {
  type: 'parse' | 'batch-parse';
  id: string;
  data?: ArrayBuffer;
  batch?: { id: string; data: ArrayBuffer }[];
}

interface DicomParserResult {
  type: 'result' | 'batch-result' | 'error';
  id: string;
  result?: {
    data: Float32Array;
    width: number;
    height: number;
  };
  batchResults?: Map<string, any>;
  error?: string;
}

// Load dicom-parser library in worker context
let dicomParser: any = null;

const loadDicomParser = async () => {
  if (dicomParser) return;
  
  try {
    // Import dicom-parser dynamically for module workers
    const dicomParserModule = await import('dicom-parser');
    dicomParser = dicomParserModule;
    
    console.log('✅ DICOM parser loaded in web worker');
  } catch (error) {
    console.error('Failed to load dicom-parser in worker:', error);
    throw error;
  }
};

const parseDicomImage = async (arrayBuffer: ArrayBuffer): Promise<any> => {
  try {
    // Ensure dicom-parser is loaded
    if (!dicomParser) {
      await loadDicomParser();
    }

    const byteArray = new Uint8Array(arrayBuffer);
    const dataSet = dicomParser.parseDicom(byteArray);

    // Extract image data
    const pixelDataElement = dataSet.elements.x7fe00010;
    if (!pixelDataElement) {
      throw new Error("No pixel data found in DICOM file");
    }

    // Get image dimensions and parameters
    const rows = dataSet.uint16("x00280010") || 512;
    const cols = dataSet.uint16("x00280011") || 512;
    const bitsAllocated = dataSet.uint16("x00280100") || 16;

    // Get rescale parameters - default to 0 intercept for MRI
    const modality = dataSet.string("x00080060") || "CT";
    const rescaleSlope = dataSet.floatString("x00281053") || 1;
    const rescaleIntercept = dataSet.floatString("x00281052") || (modality === "MR" ? 0 : -1024);

    if (bitsAllocated === 16) {
      const rawPixelArray = new Uint16Array(
        arrayBuffer,
        pixelDataElement.dataOffset,
        pixelDataElement.length / 2,
      );
      
      // Convert to Hounsfield Units - this is the heavy computation
      const huPixelArray = new Float32Array(rawPixelArray.length);
      for (let i = 0; i < rawPixelArray.length; i++) {
        huPixelArray[i] = rawPixelArray[i] * rescaleSlope + rescaleIntercept;
      }

      return {
        data: huPixelArray,
        width: cols,
        height: rows,
      };
    } else {
      throw new Error("Only 16-bit images supported");
    }
  } catch (error: any) {
    console.error("Error parsing DICOM image in worker:", error);
    throw error;
  }
};

// Handle messages from main thread
self.addEventListener('message', async (event: MessageEvent<DicomParserMessage>) => {
  const { type, id, data, batch } = event.data;
  
  try {
    if (type === 'parse' && data) {
      // Single image parsing
      const result = await parseDicomImage(data);
      
      const response: DicomParserResult = {
        type: 'result',
        id,
        result
      };
      
      self.postMessage(response);
      
    } else if (type === 'batch-parse' && batch) {
      // Batch parsing for better performance
      const batchResults = new Map<string, any>();
      
      // Process batch in parallel chunks
      const CHUNK_SIZE = 5;
      for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
        const chunk = batch.slice(i, i + CHUNK_SIZE);
        
        await Promise.all(chunk.map(async (item) => {
          try {
            const result = await parseDicomImage(item.data);
            batchResults.set(item.id, result);
          } catch (error: any) {
            console.error(`Failed to parse ${item.id}:`, error);
            batchResults.set(item.id, { error: error.message });
          }
        }));
      }
      
      // Convert Map to serializable format
      const serializableResults: any = {};
      batchResults.forEach((value, key) => {
        serializableResults[key] = value;
      });
      
      const response: DicomParserResult = {
        type: 'batch-result',
        id,
        batchResults: serializableResults
      };
      
      self.postMessage(response);
    }
  } catch (error: any) {
    const response: DicomParserResult = {
      type: 'error',
      id,
      error: error.message
    };
    
    self.postMessage(response);
  }
});

// Initialize worker
(async () => {
  try {
    await loadDicomParser();
    console.log('🚀 DICOM parser web worker ready');
  } catch (error) {
    console.error('Failed to initialize DICOM parser worker:', error);
  }
})();

export {};