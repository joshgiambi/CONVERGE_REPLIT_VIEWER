#!/usr/bin/env tsx
/**
 * Script to populate registration relationships for existing data
 *
 * Usage:
 *   tsx scripts/populate-registration-relationships.ts
 *   tsx scripts/populate-registration-relationships.ts --patient-id=1
 *   tsx scripts/populate-registration-relationships.ts --study-id=5
 */

import { storage } from '../server/storage';
import {
  processPatientRegistrationRelationships,
  processStudyRegistrationRelationships
} from '../server/services/registration-relationship-service';

async function main() {
  const args = process.argv.slice(2);
  const patientIdArg = args.find(arg => arg.startsWith('--patient-id='));
  const studyIdArg = args.find(arg => arg.startsWith('--study-id='));

  try {
    if (patientIdArg) {
      // Process specific patient
      const patientId = Number(patientIdArg.split('=')[1]);
      if (!Number.isFinite(patientId)) {
        console.error('❌ Invalid patient ID');
        process.exit(1);
      }

      console.log(`🔄 Processing registration relationships for patient ${patientId}...`);
      const count = await processPatientRegistrationRelationships(patientId);
      console.log(`✅ Created ${count} registration relationships for patient ${patientId}`);

    } else if (studyIdArg) {
      // Process specific study
      const studyId = Number(studyIdArg.split('=')[1]);
      if (!Number.isFinite(studyId)) {
        console.error('❌ Invalid study ID');
        process.exit(1);
      }

      console.log(`🔄 Processing registration relationships for study ${studyId}...`);
      const count = await processStudyRegistrationRelationships(studyId);
      console.log(`✅ Created ${count} registration relationships for study ${studyId}`);

    } else {
      // Process all patients
      console.log('🔄 Processing registration relationships for all patients...');
      const patients = await storage.getAllPatients();

      let totalCount = 0;
      for (const patient of patients) {
        console.log(`\n📋 Processing patient: ${patient.patientName} (ID: ${patient.id})`);
        const count = await processPatientRegistrationRelationships(patient.id);
        totalCount += count;
        console.log(`  ✅ Created ${count} relationships`);
      }

      console.log(`\n🎉 Complete! Created ${totalCount} total registration relationships`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();