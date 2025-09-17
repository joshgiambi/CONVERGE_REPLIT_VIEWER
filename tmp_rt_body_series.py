import pydicom
import psycopg
import os

# DB URL
for line in open('.env'):
    if line.startswith('DATABASE_URL'):
        db_url = line.split('=')[1].strip().strip('"')
        break

with psycopg.connect(db_url) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT i.file_path FROM images i JOIN series s ON i.series_id=s.id WHERE s.study_id=20 AND s.modality='RTSTRUCT' ORDER BY s.id")
        rts = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT sop_instance_uid, series_id FROM images")
        m = {r[0]: r[1] for r in cur.fetchall()}

for p in rts:
    ds = pydicom.dcmread(p)
    print('----', p)
    # find BODY ROI number
    body_nums = []
    if hasattr(ds, 'StructureSetROISequence'):
        for roi in ds.StructureSetROISequence:
            if 'BODY' in str(getattr(roi, 'ROIName', '')).upper():
                body_nums.append(int(getattr(roi, 'ROINumber', -1)))
    print('BODY ROI numbers:', body_nums)
    if not body_nums:
        continue
    for rc in ds.ROIContourSequence:
        if int(getattr(rc, 'ReferencedROINumber', -1)) not in body_nums:
            continue
        sids = set()
        cnt = 0
        for cont in rc.ContourSequence:
            if hasattr(cont, 'ContourImageSequence'):
                for ci in cont.ContourImageSequence:
                    sop = getattr(ci, 'ReferencedSOPInstanceUID', None)
                    sid = m.get(sop)
                    if sid:
                        sids.add(int(sid))
                        cnt += 1
        print('BODY referenced series IDs:', sorted(sids), 'from', cnt, 'refs')
