import pydicom
import os
import json

# Check slice positions for MRI series
mri_dir = 'attached_assets/fusion-dataset-2mri/CVYcHcklTsv2rCX042yyFyZJX'

print("Checking MRI slice positions...\n")

# Collect all MR files
mr_files = []
for file in os.listdir(mri_dir):
    if file.startswith('MR.') and file.endswith('.dcm'):
        mr_files.append(os.path.join(mri_dir, file))

# Sort files by name
mr_files.sort()

# Only check first 5 and last 5 files
sample_files = mr_files[:5] + mr_files[-5:] if len(mr_files) > 10 else mr_files

for file_path in sample_files:
    try:
        ds = pydicom.dcmread(file_path)
        
        print(f"File: {os.path.basename(file_path)}")
        print(f"Series: {ds.SeriesDescription if hasattr(ds, 'SeriesDescription') else 'N/A'}")
        print(f"Instance Number: {ds.InstanceNumber if hasattr(ds, 'InstanceNumber') else 'N/A'}")
        
        # Check slice location
        if hasattr(ds, 'SliceLocation'):
            print(f"Slice Location: {ds.SliceLocation}")
        else:
            print("Slice Location: Not specified")
            
        # Check image position patient
        if hasattr(ds, 'ImagePositionPatient'):
            print(f"Image Position Patient: {ds.ImagePositionPatient}")
            print(f"  Z position: {ds.ImagePositionPatient[2]}")
        else:
            print("Image Position Patient: Not specified")
            
        # Check slice thickness
        if hasattr(ds, 'SliceThickness'):
            print(f"Slice Thickness: {ds.SliceThickness}")
            
        print("-" * 50)
        
    except Exception as e:
        print(f"Error reading {file_path}: {e}")

# Also check CT files for comparison
print("\n\nChecking CT slice positions for comparison...\n")
ct_files = []
for file in os.listdir(mri_dir):
    if file.startswith('CT.') and file.endswith('.dcm'):
        ct_files.append(os.path.join(mri_dir, file))

ct_files.sort()
sample_ct = ct_files[:3] + ct_files[-3:] if len(ct_files) > 6 else ct_files

for file_path in sample_ct:
    try:
        ds = pydicom.dcmread(file_path)
        
        print(f"File: {os.path.basename(file_path)}")
        print(f"Instance Number: {ds.InstanceNumber if hasattr(ds, 'InstanceNumber') else 'N/A'}")
        print(f"Slice Location: {ds.SliceLocation if hasattr(ds, 'SliceLocation') else 'N/A'}")
        if hasattr(ds, 'ImagePositionPatient'):
            print(f"Z position: {ds.ImagePositionPatient[2]}")
        print("-" * 30)
        
    except Exception as e:
        print(f"Error reading {file_path}: {e}")