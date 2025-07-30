import zipfile
import os

zip_path = 'attached_assets/Fused_MRI_1752694246784.zip'

print(f"Analyzing {zip_path}...")
print(f"File size: {os.path.getsize(zip_path)} bytes")

# Open and analyze the zip file
with zipfile.ZipFile(zip_path, 'r') as zip_file:
    file_list = zip_file.namelist()
    print(f"\nTotal files: {len(file_list)}")
    
    # Group files by directory
    dirs = {}
    for file in file_list:
        if not file.startswith('__MACOSX'):  # Skip macOS metadata
            parts = file.split('/')
            if len(parts) > 1:
                dir_name = '/'.join(parts[:-1])
                if dir_name not in dirs:
                    dirs[dir_name] = []
                if not file.endswith('/'):
                    dirs[dir_name].append(parts[-1])
    
    print("\nDirectory structure:")
    for dir_name, files in sorted(dirs.items()):
        if files:  # Only show directories with files
            print(f"\n{dir_name}: {len(files)} files")
            # Show first few files
            for i, file in enumerate(files[:5]):
                print(f"  - {file}")
            if len(files) > 5:
                print(f"  ... and {len(files) - 5} more")
    
    # Look for DICOM files by extension
    dicom_extensions = ['.dcm', '.dicom', '.ima']
    dicom_files = [f for f in file_list if any(f.lower().endswith(ext) for ext in dicom_extensions)]
    
    # Also look for files without extensions that might be DICOM
    no_ext_files = [f for f in file_list if '.' not in os.path.basename(f) and not f.endswith('/') and not f.startswith('__MACOSX')]
    
    print(f"\n\nDICOM files found: {len(dicom_files)}")
    print(f"Files without extension (potential DICOM): {len(no_ext_files)}")
    
    # Look for specific modalities
    if dicom_files:
        print("\nSample DICOM files:")
        for f in dicom_files[:10]:
            print(f"  - {f}")
    
    # Look for registration files
    reg_files = [f for f in file_list if 'reg' in f.lower() or 'registration' in f.lower()]
    if reg_files:
        print(f"\nPotential registration files: {len(reg_files)}")
        for f in reg_files:
            print(f"  - {f}")
            
    # Look for MRI indicators
    mri_files = [f for f in file_list if 'mri' in f.lower() or 'mr' in f.lower()]
    if mri_files:
        print(f"\nPotential MRI files: {len(mri_files)}")
        for f in mri_files[:5]:
            print(f"  - {f}")