import pydicom

# Examine the registration file
reg_file = 'attached_assets/fusion-dataset/eGxOwa0vElJ9I98DElZly59D5/RE.eGxOwa0vElJ9I98DElZly59D5.REGISTRATION.dcm'

print("Examining DICOM Registration file...\n")

try:
    ds = pydicom.dcmread(reg_file)
    
    print(f"SOP Class UID: {ds.SOPClassUID if hasattr(ds, 'SOPClassUID') else 'N/A'}")
    print(f"Modality: {ds.Modality if hasattr(ds, 'Modality') else 'N/A'}")
    print(f"Series Description: {ds.SeriesDescription if hasattr(ds, 'SeriesDescription') else 'N/A'}")
    
    # Look for registration sequence
    if hasattr(ds, 'RegistrationSequence'):
        print("\nRegistration Sequence found!")
        for i, reg in enumerate(ds.RegistrationSequence):
            print(f"\nRegistration #{i+1}:")
            
            # Check for transformation matrix
            if hasattr(reg, 'MatrixRegistrationSequence'):
                for j, matrix_reg in enumerate(reg.MatrixRegistrationSequence):
                    print(f"  Matrix Registration #{j+1}:")
                    
                    if hasattr(matrix_reg, 'MatrixSequence'):
                        for k, matrix in enumerate(matrix_reg.MatrixSequence):
                            print(f"    Matrix #{k+1}:")
                            
                            # Get the 4x4 transformation matrix
                            if hasattr(matrix, 'FrameOfReferenceTransformationMatrix'):
                                transform = matrix.FrameOfReferenceTransformationMatrix
                                print(f"      Transformation Matrix (4x4):")
                                # Convert to 4x4 matrix manually
                                for i in range(4):
                                    row = transform[i*4:(i+1)*4]
                                    print(f"        {row}")
                                    
                            if hasattr(matrix, 'FrameOfReferenceTransformationMatrixType'):
                                print(f"      Matrix Type: {matrix.FrameOfReferenceTransformationMatrixType}")
    
    # Look for referenced frame of reference
    if hasattr(ds, 'ReferencedFrameOfReferenceSequence'):
        print("\nReferenced Frame of Reference:")
        for ref in ds.ReferencedFrameOfReferenceSequence:
            if hasattr(ref, 'FrameOfReferenceUID'):
                print(f"  Frame of Reference UID: {ref.FrameOfReferenceUID}")
                
    # Look for deformable registration sequence
    if hasattr(ds, 'DeformableRegistrationSequence'):
        print("\nDeformable Registration found")
        
    # Print all available tags for exploration
    print("\nAll available tags:")
    for elem in ds:
        if elem.VR != 'SQ':  # Skip sequences for now
            print(f"  {elem.tag}: {elem.keyword} = {elem.value[:100] if isinstance(elem.value, (str, bytes)) else elem.value}")
            
except Exception as e:
    print(f"Error reading registration file: {e}")
    
print("\nDone!")