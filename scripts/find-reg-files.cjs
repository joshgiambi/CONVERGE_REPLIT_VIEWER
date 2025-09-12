// Scan storage/patients recursively for DICOM REG files and print their paths
// Usage: node scripts/find-reg-files.js [max=5]
const fs = require('fs');
const path = require('path');
const dicomParser = require('dicom-parser');

const root = path.join(process.cwd(), 'storage', 'patients');
const limit = Number(process.argv[2] || 5);
let found = 0;

function tryIsReg(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const ds = dicomParser.parseDicom(new Uint8Array(buf));
    const sop = ds.string('x00080016');
    return sop === '1.2.840.10008.5.1.4.1.1.66.1' || sop === '1.2.840.10008.5.1.4.1.1.66.3';
  } catch {
    return false;
  }
}

function walk(dir) {
  if (found >= limit) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (found >= limit) return;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.dcm')) {
      if (tryIsReg(full)) {
        console.log(full);
        found++;
        if (found >= limit) return;
      }
    }
  }
}

if (fs.existsSync(root)) {
  walk(root);
}

