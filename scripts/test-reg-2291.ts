import 'dotenv/config';
import { processSeriesRegistrationRelationships } from '../server/services/registration-relationship-service';

console.log('Testing REG series 2291 (should link CBCT 2286 to Planning CT 2287)...\n');

await processSeriesRegistrationRelationships(2291);

console.log('\nDone! Check if relationship was created.');
process.exit(0);