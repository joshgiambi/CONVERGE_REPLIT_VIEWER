#!/usr/bin/env python3
"""
Volume resampling for fusion precomputation.
Resamples entire secondary series to primary's frame of reference and saves as DICOM.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import List

import numpy as np
import SimpleITK as sitk
import time
import random

# Add parent directory to path for imports
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from fusebox_resample import (
    read_series,
    affine_from_row_major,
    flatten_composite_transform,
    ensure_moving_to_fixed,
    describe_series
)


def copy_dicom_tags(reader: sitk.ImageSeriesReader, resampled: sitk.Image) -> None:
    """Copy essential DICOM tags from original to resampled image."""
    # Get metadata keys from first file
    if reader.GetFileNames():
        first_file = reader.GetFileNames()[0]
        reader_single = sitk.ImageFileReader()
        reader_single.SetFileName(first_file)
        reader_single.LoadPrivateTagsOn()
        reader_single.ReadImageInformation()
        
        # Copy important tags
        important_tags = [
            "0008|0060",  # Modality
            "0008|0008",  # Image Type
            "0008|0070",  # Manufacturer
            "0018|0050",  # Slice Thickness
            "0018|0088",  # Spacing Between Slices
            "0028|0030",  # Pixel Spacing
            "0028|1050",  # Window Center
            "0028|1051",  # Window Width
            "0028|1052",  # Rescale Intercept
            "0028|1053",  # Rescale Slope
        ]
        
        for tag in important_tags:
            if reader_single.HasMetaDataKey(tag):
                value = reader_single.GetMetaData(tag)
                # Set for all slices
                for i in range(resampled.GetDepth()):
                    resampled.SetMetaData(f"{i}.{tag}", value)


def save_as_dicom_series(
    image: sitk.Image,
    output_dir: str,
    series_description: str = "Fused Series",
    original_series_uid: str = "",
) -> None:
    """Save the resampled image as individual DICOM slices."""
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate UIDs
    series_uid = f"1.2.826.0.1.3680043.2.1125.{int(time.time())}.{random.randint(1000, 9999)}"
    study_uid = f"1.2.826.0.1.3680043.2.1125.{int(time.time())}.{random.randint(10000, 19999)}"
    frame_of_ref_uid = f"1.2.826.0.1.3680043.2.1125.{int(time.time())}.{random.randint(20000, 29999)}"
    
    # Get the size of the 3D image
    size = image.GetSize()
    depth = size[2] if len(size) > 2 else 1
    
    # Write each slice as individual DICOM file
    writer = sitk.ImageFileWriter()
    writer.KeepOriginalImageUIDOn()
    
    for i in range(depth):
        # Extract slice
        if depth > 1:
            slice_filter = sitk.ExtractImageFilter()
            slice_filter.SetSize([size[0], size[1], 0])
            slice_filter.SetIndex([0, 0, i])
            slice_img = slice_filter.Execute(image)
        else:
            slice_img = image
        
        # Set metadata
        slice_img.SetMetaData("0008|0060", "CT")  # Modality
        slice_img.SetMetaData("0008|0031", series_description)  # Series Description
        slice_img.SetMetaData("0020|000e", series_uid)  # Series Instance UID
        slice_img.SetMetaData("0020|000d", study_uid)  # Study Instance UID
        slice_img.SetMetaData("0020|0052", frame_of_ref_uid)  # Frame of Reference UID
        slice_img.SetMetaData("0020|0013", str(i + 1))  # Instance Number
        slice_img.SetMetaData("0008|0018", f"1.2.826.0.1.3680043.2.1125.{int(time.time())}.{random.randint(30000 + i, 39999 + i)}")  # SOP Instance UID
        
        # Calculate position for this slice
        origin = list(image.GetOrigin())
        spacing = image.GetSpacing()
        direction = image.GetDirection()
        
        # Z position moves with slice
        if len(size) > 2 and len(spacing) > 2:
            origin[2] += i * spacing[2]
        
        slice_img.SetOrigin(origin)
        
        # Convert to appropriate pixel type for DICOM (signed 16-bit)
        cast_filter = sitk.CastImageFilter()
        cast_filter.SetOutputPixelType(sitk.sitkInt16)
        slice_img_int16 = cast_filter.Execute(slice_img)
        
        # Write the slice
        filename = f"slice_{i:04d}.dcm"
        filepath = os.path.join(output_dir, filename)
        writer.SetFileName(filepath)
        writer.SetUseCompression(False)
        writer.Execute(slice_img_int16)
    
    print(f"Saved {depth} DICOM slices to {output_dir}")


def save_as_dicom_series_old(
    image: sitk.Image,
    output_dir: str,
    series_description: str = "Fused Series",
    original_series_uid: str = "",
) -> None:
    """Save a 3D image as a DICOM series."""
    writer = sitk.ImageSeriesWriter()
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate file names
    depth = image.GetDepth()
    file_names = [
        os.path.join(output_dir, f"slice_{i:04d}.dcm")
        for i in range(depth)
    ]
    
    # Set up the writer
    writer.SetFileNames(file_names)
    
    # Generate new UIDs
    series_uid = f"1.2.826.0.1.3680043.2.1125.{int(time.time())}.{random.randint(1000, 9999)}"
    study_uid = f"1.2.826.0.1.3680043.2.1125.{int(time.time())}.{random.randint(10000, 19999)}"
    frame_of_ref_uid = f"1.2.826.0.1.3680043.2.1125.{int(time.time())}.{random.randint(20000, 29999)}"
    
    # Set essential DICOM tags
    base_tags = {
        "0008|0060": "CT",  # Modality (will be overridden by copied tags)
        "0008|0020": "",    # Study Date
        "0008|0030": "",    # Study Time
        "0008|0050": "",    # Accession Number
        "0008|0090": "",    # Referring Physician
        "0010|0010": "",    # Patient Name
        "0010|0020": "",    # Patient ID
        "0010|0030": "",    # Patient Birth Date
        "0010|0040": "",    # Patient Sex
        "0020|000d": study_uid,     # Study Instance UID
        "0020|000e": series_uid,    # Series Instance UID
        "0020|0010": "",            # Study ID
        "0020|0011": "1001",        # Series Number (offset to avoid conflicts)
        "0020|0052": frame_of_ref_uid,  # Frame of Reference UID
        "0008|103e": series_description,  # Series Description
    }
    
    # Apply tags to each slice
    for i in range(depth):
        for tag, value in base_tags.items():
            image.SetMetaData(f"{i}.{tag}", value)
        
        # Set slice-specific tags
        image.SetMetaData(f"{i}.0020|0013", str(i + 1))  # Instance Number
        image.SetMetaData(f"{i}.0008|0018", f"1.2.826.0.1.3680043.2.1125.{int(time.time())}.{random.randint(30000 + i, 39999 + i)}")  # SOP Instance UID
        
        # Calculate Image Position Patient for this slice
        # This is critical for proper display
        origin = image.GetOrigin()
        spacing = image.GetSpacing()
        direction = image.GetDirection()
        
        # Calculate position for this slice
        # Assuming axial slices (most common case)
        slice_pos = [
            origin[0],
            origin[1],
            origin[2] + i * spacing[2]
        ]
        
        ipp_string = f"{slice_pos[0]:.6f}\\{slice_pos[1]:.6f}\\{slice_pos[2]:.6f}"
        image.SetMetaData(f"{i}.0020|0032", ipp_string)  # Image Position Patient
        
        # Image Orientation Patient (assuming axial)
        iop_string = f"{direction[0]:.6f}\\{direction[3]:.6f}\\{direction[6]:.6f}\\{direction[1]:.6f}\\{direction[4]:.6f}\\{direction[7]:.6f}"
        image.SetMetaData(f"{i}.0020|0037", iop_string)
    
    # Execute the writing
    writer.Execute(image)
    print(f"Saved {depth} DICOM slices to {output_dir}")


def resample_volume(
    primary: sitk.Image,
    secondary: sitk.Image,
    transform: sitk.Transform,
    interpolation: str = "linear"
) -> sitk.Image:
    """Resample entire secondary volume to primary's grid."""
    resample_filter = sitk.ResampleImageFilter()
    resample_filter.SetReferenceImage(primary)
    resample_filter.SetTransform(transform)
    
    if interpolation.lower() == "nearest":
        resample_filter.SetInterpolator(sitk.sitkNearestNeighbor)
    else:
        resample_filter.SetInterpolator(sitk.sitkLinear)
    
    resample_filter.SetDefaultPixelValue(0.0)
    resample_filter.SetOutputPixelType(secondary.GetPixelID())
    
    return resample_filter.Execute(secondary)


def main():
    parser = argparse.ArgumentParser(description="Resample full volume for fusion")
    parser.add_argument("--config", required=True, help="Path to JSON config file")
    args = parser.parse_args()
    
    # Load configuration
    with open(args.config, 'r') as f:
        config = json.load(f)
    
    primary_files = config["primary"]
    secondary_files = config["secondary"]
    output_dir = config["outputDir"]
    transform_data = config.get("transform")
    transform_file = config.get("transformFile")
    invert_transform = config.get("invertTransformFile", True)
    interpolation = config.get("interpolation", "linear")
    
    if not primary_files or not secondary_files:
        raise ValueError("Primary and secondary file lists required")
    
    print(f"Loading primary series ({len(primary_files)} files)...")
    primary = read_series(primary_files)
    
    print(f"Loading secondary series ({len(secondary_files)} files)...")
    secondary = read_series(secondary_files)
    
    # Get transform
    if transform_file:
        print(f"Loading transform from: {transform_file}")
        raw_xform = sitk.ReadTransform(transform_file)
        xform = flatten_composite_transform(raw_xform)
        if invert_transform:
            xform = ensure_moving_to_fixed(xform)
    elif transform_data:
        print(f"Using matrix transform")
        raw = affine_from_row_major([float(v) for v in transform_data])
        xform = ensure_moving_to_fixed(raw)
    else:
        raise ValueError("Either transform or transformFile must be provided")
    
    print(f"Transform type: {xform.GetName()}")
    print(f"Primary size: {primary.GetSize()}, spacing: {primary.GetSpacing()}")
    print(f"Secondary size: {secondary.GetSize()}, spacing: {secondary.GetSpacing()}")
    
    # Resample the volume
    print("Resampling volume...")
    resampled = resample_volume(primary, secondary, xform, interpolation)
    print(f"Resampled size: {resampled.GetSize()}")
    
    # Copy metadata from original secondary
    reader = sitk.ImageSeriesReader()
    reader.SetFileNames(secondary_files)
    copy_dicom_tags(reader, resampled)
    
    # Determine series description
    modality = "Unknown"
    if secondary_files:
        try:
            temp_reader = sitk.ImageFileReader()
            temp_reader.SetFileName(secondary_files[0])
            temp_reader.LoadPrivateTagsOn()
            temp_reader.ReadImageInformation()
            if temp_reader.HasMetaDataKey("0008|0060"):
                modality = temp_reader.GetMetaData("0008|0060")
        except:
            pass
    
    series_desc = f"{modality} fused to primary"
    
    # Save as DICOM series
    print(f"Saving to {output_dir}...")
    save_as_dicom_series(
        resampled,
        output_dir,
        series_description=series_desc,
    )
    
    print("Volume resampling complete!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
