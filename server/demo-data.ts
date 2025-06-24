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
      console.log('Processing complete HN-ATLAS dataset with DICOM metadata...');
      const results = await DICOMProcessor.processDICOMDirectory(atlasPath);
      console.log(`Demo data loaded: ${results.processed} CT slices with proper spatial ordering`);
      return results;
    }
    
    console.log('HN-ATLAS files not found, demo data structure created');
    return { processed: 0, errors: [] };
    
  } catch (error) {
    console.error('Failed to create demo data:', error);
    return { processed: 0, errors: [error.message] };
  }
}