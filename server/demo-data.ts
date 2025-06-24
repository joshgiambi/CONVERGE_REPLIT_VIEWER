import { DICOMProcessor } from './dicom-processor';
import path from 'path';
import fs from 'fs';

export async function createDemoData() {
  try {
    console.log('🔄 Loading HN-ATLAS demo dataset...');
    
    // Process the HN-ATLAS dataset from attached assets
    const atlasPath = path.join(process.cwd(), 'attached_assets/HN-ATLAS-84');
    
    if (!fs.existsSync(atlasPath)) {
      console.log('⚠️  HN-ATLAS dataset not found in attached_assets');
      return;
    }
    
    const results = await DICOMProcessor.processDICOMDirectory(atlasPath);
    
    console.log(`✅ Demo data loaded: ${results.processed} DICOM files processed`);
    if (results.errors.length > 0) {
      console.log(`⚠️  ${results.errors.length} files had errors`);
      results.errors.slice(0, 3).forEach(error => console.log(`   - ${error}`));
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Failed to create demo data:', error);
    throw error;
  }
}