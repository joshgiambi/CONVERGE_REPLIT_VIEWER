import 'dotenv/config';
import { processSeriesRegistrationRelationships } from '../server/services/registration-relationship-service';

(async () => {
  console.log('Processing series 2284 (PT) for registration relationships...');
  await processSeriesRegistrationRelationships(2284);
  console.log('Done!');
  process.exit(0);
})();