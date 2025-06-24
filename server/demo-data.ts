import { DICOMProcessor } from './dicom-processor';
import path from 'path';
import fs from 'fs';

export async function createDemoData() {
  try {
    // Check if demo data already exists
    const { storage } = await import('./dicom-storage');
    const existingPatients = await storage.getPatients();
    
    if (existingPatients.length > 0) {
      console.log('Demo data already exists');
      return { processed: existingPatients.length, errors: [] };
    }
    
    console.log('Creating HN-ATLAS demo dataset...');
    
    // Create demo patient and study that matches the database entries
    const atlasPath = path.join(process.cwd(), 'attached_assets/HN-ATLAS-84/DICOM_CONTRAST');
    
    if (fs.existsSync(atlasPath)) {
      // Add first 30 DICOM images to demonstrate the viewer functionality
      const files = fs.readdirSync(atlasPath)
        .filter(f => f.endsWith('.dcm'))
        .slice(0, 30)
        .sort();
      
      for (let i = 0; i < files.length; i++) {
        const filePath = path.join(atlasPath, files[i]);
        const stats = fs.statSync(filePath);
        
        // Create image entry with proper metadata
        await storage.createImage({
          seriesId: 1,
          sopInstanceUID: `2.16.840.1.114362.1.11932039.ct.${(i + 1).toString().padStart(3, '0')}`,
          instanceNumber: i + 1,
          filePath: filePath,
          fileName: files[i],
          fileSize: stats.size,
          sliceLocation: ((i + 1) * 3).toString(), // 3mm slice thickness
          metadata: {
            source: 'HN-ATLAS-84',
            anatomy: 'Head & Neck',
            contrast: true,
            sliceIndex: i + 1,
            totalSlices: files.length
          }
        });
      }
      
      console.log(`Demo data loaded: ${files.length} CT slices`);
      return { processed: files.length, errors: [] };
    }
    
    console.log('HN-ATLAS files not found, demo data structure created');
    return { processed: 0, errors: [] };
    
  } catch (error) {
    console.error('Failed to create demo data:', error);
    return { processed: 0, errors: [error.message] };
  }
}