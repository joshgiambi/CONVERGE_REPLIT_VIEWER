import { db } from './server/db.js';
import { studies } from './shared/schema.js';
import { eq } from 'drizzle-orm';

async function fixStudyPatientLink() {
  console.log('Fixing study patient link...\n');
  
  // Update study 14 to link to patient 20
  console.log('Updating study 14 to link to patient 20...');
  
  const result = await db.update(studies)
    .set({ patientId: 20 })
    .where(eq(studies.id, 14))
    .returning();
    
  console.log('Updated study:', result);
  
  // Verify the update
  const updatedStudy = await db.select().from(studies).where(eq(studies.id, 14));
  console.log('\nVerification - Study 14 now has patientId:', updatedStudy[0].patientId);
  
  process.exit(0);
}

fixStudyPatientLink().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});