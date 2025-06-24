import { DICOMProcessor } from './dicom-processor';
import path from 'path';
import fs from 'fs';

export async function createDemoData() {
  try {
    console.log('Loading HN-ATLAS demo dataset...');
    
    // Process the HN-ATLAS dataset from attached assets
    const atlasPath = path.join(process.cwd(), 'attached_assets/HN-ATLAS-84');
    
    if (!fs.existsSync(atlasPath)) {
      console.log('HN-ATLAS dataset not found, creating sample data...');
      
      // Create a simple demo patient/study for testing
      const { storage } = await import('./dicom-storage');
      
      const patient = await storage.createPatient({
        patientID: 'DEMO-001',
        patientName: 'Demo Patient',
        patientSex: 'U',
        patientAge: 'Unknown'
      });

      const study = await storage.createStudy({
        studyInstanceUID: '2.25.demo.study.001',
        patientId: patient.id,
        patientName: patient.patientName,
        patientIdDicom: patient.patientID,
        studyDate: new Date().toISOString().split('T')[0].replace(/-/g, ''),
        studyDescription: 'Demo Study - No DICOM Files',
        modality: 'CT',
        numberOfSeries: 0,
        numberOfImages: 0,
        isDemo: true
      });

      console.log('Demo data created: 1 patient, 1 study (no images)');
      return { processed: 0, errors: ['No DICOM files found - demo patient created'] };
    }
    
    const results = await DICOMProcessor.processDICOMDirectory(atlasPath);
    
    console.log(`Demo data loaded: ${results.processed} DICOM files processed`);
    if (results.errors.length > 0) {
      console.log(`${results.errors.length} files had errors`);
      results.errors.slice(0, 3).forEach(error => console.log(`   - ${error}`));
    }
    
    return results;
    
  } catch (error) {
    console.error('Failed to create demo data:', error);
    throw error;
  }
}