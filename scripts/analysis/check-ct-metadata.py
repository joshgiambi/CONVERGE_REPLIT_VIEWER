import pydicom
import os
import json

# Check CT DICOM metadata directly from files
ct_dir = "storage/patients/6/1.2.246.352.221.571147691131710059210109765375903641232/1.2.246.352.221.496852523188964609911001396652665546125"

if os.path.exists(ct_dir):
    # Get a few CT files to check
    files = sorted([f for f in os.listdir(ct_dir) if f.endswith('.dcm')])[:5]
    
    print("Checking CT DICOM metadata directly from files:")
    print("-" * 80)
    
    for filename in files:
        filepath = os.path.join(ct_dir, filename)
        try:
            ds = pydicom.dcmread(filepath)
            
            print(f"\nFile: {filename}")
            print(f"SOP Instance UID: {ds.SOPInstanceUID}")
            
            if hasattr(ds, 'ImagePositionPatient'):
                print(f"Image Position Patient: {list(ds.ImagePositionPatient)}")
                print(f"  X: {ds.ImagePositionPatient[0]}")
                print(f"  Y: {ds.ImagePositionPatient[1]}")
                print(f"  Z: {ds.ImagePositionPatient[2]}")
            
            if hasattr(ds, 'SliceLocation'):
                print(f"Slice Location: {ds.SliceLocation}")
                
            if hasattr(ds, 'InstanceNumber'):
                print(f"Instance Number: {ds.InstanceNumber}")
                
            if hasattr(ds, 'ImageOrientationPatient'):
                print(f"Image Orientation Patient: {list(ds.ImageOrientationPatient)}")
                
        except Exception as e:
            print(f"Error reading {filename}: {e}")
else:
    print(f"CT directory not found: {ct_dir}")

# Also check if there's a specific file for instance 95
print("\n" + "="*80)
print("Looking for instance 95 specifically...")

for root, dirs, files in os.walk("storage/patients"):
    for file in files:
        if file.endswith('.dcm'):
            filepath = os.path.join(root, file)
            try:
                ds = pydicom.dcmread(filepath)
                if hasattr(ds, 'InstanceNumber') and ds.InstanceNumber == 95:
                    print(f"\nFound instance 95: {filepath}")
                    print(f"Image Position Patient: {list(ds.ImagePositionPatient)}")
                    print(f"Slice Location: {ds.SliceLocation}")
                    break
            except:
                pass