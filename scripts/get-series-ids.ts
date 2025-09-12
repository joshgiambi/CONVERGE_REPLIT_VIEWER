/*
  Print DB series IDs for given SeriesInstanceUIDs.
  Usage:
    npx tsx scripts/get-series-ids.ts --uids UID1,UID2,UID3
*/
import { storage } from '../server/storage.ts';

async function main() {
  const args = process.argv.slice(2);
  const getArg = (k: string) => { const i = args.indexOf(k); return i > -1 ? args[i+1] : undefined; };
  const uidsCSV = getArg('--uids');
  if (!uidsCSV) {
    console.error('Usage: --uids <uid1,uid2,...>');
    process.exit(1);
  }
  const uids = uidsCSV.split(',').map(s => s.trim()).filter(Boolean);
  const out: any[] = [];
  for (const uid of uids) {
    try {
      const s = await storage.getSeriesByUID(uid);
      out.push({ uid, id: s?.id ?? null, studyId: s?.studyId ?? null, modality: (s as any)?.modality ?? null, description: (s as any)?.seriesDescription ?? null });
    } catch (e) {
      out.push({ uid, error: (e as any)?.message || String(e) });
    }
  }
  console.log(JSON.stringify({ ok: true, series: out }, null, 2));
}

main();

