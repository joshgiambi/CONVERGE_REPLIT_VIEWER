#!/usr/bin/env tsx
import { parseDicomRegistrationFromFile } from '../server/registration/reg-parser.ts';
import { storage } from '../server/storage.ts';
import { db } from '../server/db.ts';

async function checkRegFileDetails() {
  // Database is already initialized via db import
  
  console.log('\n🔍 Checking REG file details...\n');
  
  // Find all REG series
  const allSeries = await storage.getAllSeries();
  const regSeries = allSeries.filter(s => s.modality === 'REG');
  
  if (regSeries.length === 0) {
    console.log('❌ No REG series found in database');
    process.exit(1);
  }
  
  for (const reg of regSeries) {
    console.log(`\n📄 REG Series ID: ${reg.id}`);
    console.log(`   Description: ${reg.seriesDescription || 'N/A'}`);
    console.log(`   Study ID: ${reg.studyId}`);
    
    // Get first image
    const images = await storage.getImagesBySeriesId(reg.id);
    if (images.length === 0) {
      console.log('   ⚠️  No images found for this REG series');
      continue;
    }
    
    const regFile = images[0].filePath;
    console.log(`   File: ${regFile}`);
    
    // Parse the REG file
    const parsed = parseDicomRegistrationFromFile(regFile);
    if (!parsed) {
      console.log('   ❌ Failed to parse REG file');
      continue;
    }
    
    console.log('\n   📊 Parsed Registration Data:');
    console.log(`   • Has matrix: ${parsed.matrixRowMajor4x4 ? 'Yes' : 'No'}`);
    console.log(`   • Source FoR UID: ${parsed.sourceFrameOfReferenceUid || 'None'}`);
    console.log(`   • Target FoR UID: ${parsed.targetFrameOfReferenceUid || 'None'}`);
    console.log(`   • Referenced Series UIDs: ${parsed.referencedSeriesInstanceUids?.length || 0}`);
    
    if (parsed.referencedSeriesInstanceUids && parsed.referencedSeriesInstanceUids.length > 0) {
      console.log(`\n   📌 Referenced Series Instance UIDs:`);
      parsed.referencedSeriesInstanceUids.forEach((uid, i) => {
        console.log(`      ${i + 1}. ${uid.substring(0, 40)}...`);
      });
    }
    
    // Determine which path will be taken
    const hasSeriesUIDs = parsed.referencedSeriesInstanceUids && parsed.referencedSeriesInstanceUids.length > 0;
    const hasFoRUIDs = parsed.sourceFrameOfReferenceUid && parsed.targetFrameOfReferenceUid;
    
    console.log('\n   🔀 Registration Type Detection:');
    if (hasSeriesUIDs) {
      console.log('   ✅ EXPLICIT SERIES REFERENCES - Will use Series Instance UID matching');
      console.log('   (FoR-only detection will NOT trigger)');
    } else if (hasFoRUIDs) {
      console.log('   ✅ FOR-ONLY REGISTRATION - Will match by Frame of Reference');
      console.log('   (FoR-only detection WILL trigger)');
    } else {
      console.log('   ❌ NO USABLE REFERENCES - Cannot create relationships');
    }
    
    // Find matching series by FoR
    if (parsed.sourceFrameOfReferenceUid && parsed.targetFrameOfReferenceUid) {
      const sourceFoRSeries = allSeries.filter(s => 
        s.frameOfReferenceUid === parsed.sourceFrameOfReferenceUid && s.modality !== 'REG'
      );
      const targetFoRSeries = allSeries.filter(s => 
        s.frameOfReferenceUid === parsed.targetFrameOfReferenceUid && s.modality !== 'REG'
      );
      
      console.log(`\n   🎯 Series matching source FoR: ${sourceFoRSeries.length}`);
      sourceFoRSeries.forEach(s => {
        console.log(`      • ${s.modality} series ${s.id}: ${s.seriesDescription}`);
      });
      
      console.log(`   🎯 Series matching target FoR: ${targetFoRSeries.length}`);
      targetFoRSeries.forEach(s => {
        console.log(`      • ${s.modality} series ${s.id}: ${s.seriesDescription}`);
      });
      
      const expectedRelationships = sourceFoRSeries.length * targetFoRSeries.length;
      console.log(`\n   📈 Expected relationships: ${expectedRelationships}`);
    }
  }
  
  process.exit(0);
}

checkRegFileDetails().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
