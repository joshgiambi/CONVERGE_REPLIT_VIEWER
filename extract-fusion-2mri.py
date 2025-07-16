import zipfile
import os
import pydicom
import json
from collections import defaultdict

# Extract the zip file
zip_path = 'attached_assets/CVYcHcklTsv2rCX042yyFyZJX_1752699359688.zip'
extract_path = 'attached_assets/fusion-dataset-2mri'

os.makedirs(extract_path, exist_ok=True)

with zipfile.ZipFile(zip_path, 'r') as zip_ref:
    zip_ref.extractall(extract_path)

print(f"Extracted files to {extract_path}")

# Analyze the DICOM files
series_info = defaultdict(lambda: {'count': 0, 'files': [], 'metadata': {}})

for root, dirs, files in os.walk(extract_path):
    for file in files:
        if file.endswith('.dcm'):
            file_path = os.path.join(root, file)
            try:
                ds = pydicom.dcmread(file_path, stop_before_pixels=True)
                
                # Extract key metadata
                modality = str(ds.Modality) if hasattr(ds, 'Modality') else 'Unknown'
                series_uid = str(ds.SeriesInstanceUID) if hasattr(ds, 'SeriesInstanceUID') else 'Unknown'
                series_desc = str(ds.SeriesDescription) if hasattr(ds, 'SeriesDescription') else 'No Description'
                
                # Store info
                series_info[series_uid]['modality'] = modality
                series_info[series_uid]['description'] = series_desc
                series_info[series_uid]['count'] += 1
                series_info[series_uid]['files'].append(file_path)
                
                # Store first file's metadata for each series
                if series_info[series_uid]['count'] == 1:
                    series_info[series_uid]['metadata'] = {
                        'PatientName': str(ds.PatientName) if hasattr(ds, 'PatientName') else '',
                        'StudyDescription': str(ds.StudyDescription) if hasattr(ds, 'StudyDescription') else '',
                        'WindowCenter': str(ds.WindowCenter) if hasattr(ds, 'WindowCenter') else '',
                        'WindowWidth': str(ds.WindowWidth) if hasattr(ds, 'WindowWidth') else '',
                        'FrameOfReferenceUID': str(ds.FrameOfReferenceUID) if hasattr(ds, 'FrameOfReferenceUID') else ''
                    }
                    
                    # For MR images, check sequence details
                    if modality == 'MR':
                        series_info[series_uid]['metadata']['SequenceName'] = str(ds.SequenceName) if hasattr(ds, 'SequenceName') else ''
                        series_info[series_uid]['metadata']['MagneticFieldStrength'] = str(ds.MagneticFieldStrength) if hasattr(ds, 'MagneticFieldStrength') else ''
                    
            except Exception as e:
                print(f"Error reading {file_path}: {e}")

# Print summary
print("\nDataset Summary:")
print("================")
for series_uid, info in series_info.items():
    print(f"\nSeries: {info['description']}")
    print(f"  Modality: {info['modality']}")
    print(f"  Images: {info['count']}")
    print(f"  UID: {series_uid}")
    if info['metadata']:
        print(f"  Patient: {info['metadata']['PatientName']}")
        print(f"  Study: {info['metadata']['StudyDescription']}")
        if info['modality'] == 'MR':
            print(f"  Sequence: {info['metadata'].get('SequenceName', 'N/A')}")

# Save detailed info to JSON
with open('fusion-2mri-analysis.json', 'w') as f:
    # Convert defaultdict to regular dict for JSON serialization
    json_data = {k: dict(v) for k, v in series_info.items()}
    json.dump(json_data, f, indent=2)

print("\nDetailed analysis saved to fusion-2mri-analysis.json")