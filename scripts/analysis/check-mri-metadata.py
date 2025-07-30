import pydicom
import json

# Check the window/level values in the MRI series
mri_files = [
    'attached_assets/fusion-dataset-2mri/CVYcHcklTsv2rCX042yyFyZJX/MR.CVYcHcklTsv2rCX042yyFyZJX.Image 1.dcm',
    'attached_assets/fusion-dataset-2mri/CVYcHcklTsv2rCX042yyFyZJX/MR.CVYcHcklTsv2rCX042yyFyZJX.Image 1.0001.dcm',
    'attached_assets/fusion-dataset-2mri/CVYcHcklTsv2rCX042yyFyZJX/MR.CVYcHcklTsv2rCX042yyFyZJX.Image 20.dcm',
    'attached_assets/fusion-dataset-2mri/CVYcHcklTsv2rCX042yyFyZJX/MR.CVYcHcklTsv2rCX042yyFyZJX.Image 20.0001.dcm'
]

print("Checking MRI metadata for window/level values...\n")

for file_path in mri_files:
    try:
        ds = pydicom.dcmread(file_path)
        
        print(f"File: {file_path}")
        print(f"Series: {ds.SeriesDescription if hasattr(ds, 'SeriesDescription') else 'N/A'}")
        print(f"Modality: {ds.Modality}")
        
        # Check for window center and width
        if hasattr(ds, 'WindowCenter'):
            print(f"Window Center: {ds.WindowCenter}")
        else:
            print("Window Center: Not specified")
            
        if hasattr(ds, 'WindowWidth'):
            print(f"Window Width: {ds.WindowWidth}")
        else:
            print("Window Width: Not specified")
            
        # Check pixel representation and photometric interpretation
        if hasattr(ds, 'PixelRepresentation'):
            print(f"Pixel Representation: {ds.PixelRepresentation}")
        if hasattr(ds, 'PhotometricInterpretation'):
            print(f"Photometric Interpretation: {ds.PhotometricInterpretation}")
            
        # Check min/max pixel values
        if hasattr(ds, 'PixelData'):
            pixel_array = ds.pixel_array
            print(f"Pixel value range: {pixel_array.min()} to {pixel_array.max()}")
            
        print("-" * 50)
        
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        
# Also check a CT file for comparison
print("\nFor comparison, checking CT metadata:")
ct_file = 'attached_assets/fusion-dataset-2mri/CVYcHcklTsv2rCX042yyFyZJX/CT.CVYcHcklTsv2rCX042yyFyZJX.Image 1.dcm'
try:
    ds = pydicom.dcmread(ct_file)
    print(f"CT Window Center: {ds.WindowCenter if hasattr(ds, 'WindowCenter') else 'Not specified'}")
    print(f"CT Window Width: {ds.WindowWidth if hasattr(ds, 'WindowWidth') else 'Not specified'}")
    if hasattr(ds, 'PixelData'):
        pixel_array = ds.pixel_array
        print(f"CT Pixel value range: {pixel_array.min()} to {pixel_array.max()}")
except Exception as e:
    print(f"Error reading CT file: {e}")