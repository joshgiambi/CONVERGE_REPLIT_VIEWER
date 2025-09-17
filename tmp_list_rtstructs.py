import pydicom
import psycopg
import os

db_url = None
for line in open('.env'):
    if line.startswith('DATABASE_URL'):
        db_url = line.split('=')[1].strip().strip('"')
        break

with psycopg.connect(db_url) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT i.file_path FROM images i JOIN series s ON i.series_id=s.id WHERE s.study_id=20 AND s.modality='RTSTRUCT' ORDER BY s.id")
        rts = [r[0] for r in cur.fetchall()]
print('RTSTRUCT files:', rts)
for p in rts:
    try:
        ds = pydicom.dcmread(p)
    except Exception as e:
        print('Failed to read', p, e)
        continue
    print('----', p)
    names = []
    if hasattr(ds, 'StructureSetROISequence'):
        for roi in ds.StructureSetROISequence:
            nm = str(getattr(roi, 'ROIName', ''))
            names.append(nm)
    print('Total ROIs:', len(names))
    for nm in names:
        if any(k in nm.upper() for k in ['BODY', 'EXTERNAL']):
            print('  candidate:', nm)
    print('  All names sample:', names[:20])
