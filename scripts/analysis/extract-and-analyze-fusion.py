import zipfile
import os
import pydicom
import json

zip_path = 'attached_assets/Fused_MRI_1752694246784.zip'
extract_path = 'attached_assets/fusion-dataset'

# Extract the dataset
print("Extracting dataset...")
with zipfile.ZipFile(zip_path, 'r') as zip_file:
    zip_file.extractall(extract_path)

print("Extraction complete. Analyzing DICOM files...")

# Analyze DICOM files
dicom_dir = os.path.join(extract_path, 'eGxOwa0vElJ9I98DElZly59D5')
series_data = {}
registration_info = {}

for filename in os.listdir(dicom_dir):
    if filename.endswith('.dcm'):
        filepath = os.path.join(dicom_dir, filename)
        try:
            ds = pydicom.dcmread(filepath, stop_before_pixels=True)
            
            # Get basic info
            modality = ds.get('Modality', 'Unknown')
            series_uid = ds.get('SeriesInstanceUID', 'Unknown')
            series_desc = ds.get('SeriesDescription', 'No Description')
            study_uid = ds.get('StudyInstanceUID', 'Unknown')
            patient_name = str(ds.get('PatientName', 'Unknown'))
            patient_id = ds.get('PatientID', 'Unknown')
            
            # Special handling for registration
            if modality == 'REG':
                print(f"\nRegistration file found: {filename}")
                # Extract registration details
                if hasattr(ds, 'RegistrationSequence'):
                    for reg_seq in ds.RegistrationSequence:
                        if hasattr(reg_seq, 'MatrixRegistrationSequence'):
                            for matrix_seq in reg_seq.MatrixRegistrationSequence:
                                if hasattr(matrix_seq, 'MatrixSequence'):
                                    print("  Contains transformation matrix")
                                    
                # Extract referenced image sequences
                if hasattr(ds, 'ReferencedImageSequence'):
                    print("  Referenced images:")
                    for ref in ds.ReferencedImageSequence:
                        ref_series = ref.get('ReferencedSOPInstanceUID', 'Unknown')
                        print(f"    - {ref_series}")
                        
                registration_info = {
                    'filename': filename,
                    'series_uid': series_uid,
                    'description': series_desc
                }
                continue
                
            # Group by series
            if series_uid not in series_data:
                series_data[series_uid] = {
                    'modality': modality,
                    'description': series_desc,
                    'study_uid': study_uid,
                    'patient_name': patient_name,
                    'patient_id': patient_id,
                    'files': [],
                    'slice_locations': []
                }
            
            # Get slice location for CT/MR
            if modality in ['CT', 'MR']:
                slice_location = ds.get('SliceLocation', None)
                instance_number = ds.get('InstanceNumber', 0)
                series_data[series_uid]['files'].append({
                    'filename': filename,
                    'instance_number': instance_number,
                    'slice_location': slice_location
                })
                if slice_location:
                    series_data[series_uid]['slice_locations'].append(slice_location)
                    
        except Exception as e:
            print(f"Error reading {filename}: {e}")

# Summarize findings
print("\n=== Dataset Summary ===")
print(f"Total series found: {len(series_data)}")

for series_uid, info in series_data.items():
    print(f"\n{info['modality']} Series: {info['description']}")
    print(f"  Series UID: {series_uid}")
    print(f"  Number of images: {len(info['files'])}")
    if info['slice_locations']:
        print(f"  Slice range: {min(info['slice_locations']):.1f} to {max(info['slice_locations']):.1f}")

if registration_info:
    print(f"\nRegistration Object:")
    print(f"  Series UID: {registration_info['series_uid']}")
    print(f"  Description: {registration_info['description']}")

# Look for RT Structure
rt_struct_found = False
for filename in os.listdir(dicom_dir):
    if 'RTSTRUCT' in filename.upper() or 'RS' in filename[:2].upper():
        rt_struct_found = True
        print(f"\nRT Structure Set found: {filename}")
        
print("\n=== Analysis Complete ===")

# Save series info for database population
series_info = {
    'patient_name': list(series_data.values())[0]['patient_name'] if series_data else 'Unknown',
    'patient_id': list(series_data.values())[0]['patient_id'] if series_data else 'Unknown',
    'series': []
}

for series_uid, info in series_data.items():
    series_info['series'].append({
        'series_uid': series_uid,
        'modality': info['modality'],
        'description': info['description'],
        'num_images': len(info['files'])
    })

with open('attached_assets/fusion-dataset/series_info.json', 'w') as f:
    json.dump(series_info, f, indent=2)
    
print(f"\nSeries information saved to series_info.json")