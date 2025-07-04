import dicomParser from 'dicom-parser';
import fs from 'fs';
import path from 'path';

// Function to parse DICOM file and extract key metadata
function parseDICOMFile(filePath) {
    try {
        const dicomFileAsBuffer = fs.readFileSync(filePath);
        const byteArray = new Uint8Array(dicomFileAsBuffer);
        const dataSet = dicomParser.parseDicom(byteArray);

        // Extract key spatial metadata
        const metadata = {
            filename: path.basename(filePath),
            // Patient Position (HFS, FFS, etc.)
            patientPosition: dataSet.string('x00185100'),
            // Image Position Patient - origin of first pixel
            imagePosition: dataSet.string('x00200032'),
            // Image Orientation Patient - direction cosines
            imageOrientation: dataSet.string('x00200037'),
            // Pixel Spacing
            pixelSpacing: dataSet.string('x00280030'),
            // Slice Thickness
            sliceThickness: dataSet.string('x00180050'),
            // Rows and Columns
            rows: dataSet.uint16('x00280010'),
            columns: dataSet.uint16('x00280011'),
            // Instance Number
            instanceNumber: dataSet.string('x00200013'),
            // Slice Location
            sliceLocation: dataSet.string('x00201041'),
            // Window Center/Width
            windowCenter: dataSet.string('x00281050'),
            windowWidth: dataSet.string('x00281051'),
            // Study/Series Description
            studyDescription: dataSet.string('x00081030'),
            seriesDescription: dataSet.string('x0008103e'),
            // Frame of Reference UID
            frameOfReferenceUID: dataSet.string('x00200052')
        };

        return metadata;
    } catch (error) {
        console.error(`Error parsing ${filePath}:`, error.message);
        return null;
    }
}

// Analyze the HN-ATLAS dataset
console.log('=== DICOM Metadata Analysis for HN-ATLAS-84 Dataset ===\n');

// Check a few sample files from the dataset
const sampleFiles = [
    './attached_assets/CT.04xy2fKzjzjjQjBsWgs8lrXPI.Image 1.dcm',
    './attached_assets/CT.04xy2fKzjzjjQjBsWgs8lrXPI.Image 10.dcm',
    './attached_assets/CT.04xy2fKzjzjjQjBsWgs8lrXPI.Image 20.dcm'
];

sampleFiles.forEach(file => {
    if (fs.existsSync(file)) {
        const metadata = parseDICOMFile(file);
        if (metadata) {
            console.log(`\n=== ${metadata.filename} ===`);
            console.log('Patient Position:', metadata.patientPosition || 'Not specified');
            console.log('Image Position:', metadata.imagePosition);
            console.log('Image Orientation:', metadata.imageOrientation);
            console.log('Pixel Spacing:', metadata.pixelSpacing);
            console.log('Image Size:', `${metadata.columns} x ${metadata.rows}`);
            console.log('Slice Location:', metadata.sliceLocation);
            console.log('Frame of Reference:', metadata.frameOfReferenceUID);
            
            // Analyze the orientation
            if (metadata.imageOrientation) {
                const orientation = metadata.imageOrientation.split('\\').map(Number);
                console.log('\nOrientation Analysis:');
                console.log('Row direction cosines (X):', orientation.slice(0, 3));
                console.log('Column direction cosines (Y):', orientation.slice(3, 6));
                
                // Check if this is standard axial orientation
                const isStandardAxial = 
                    Math.abs(orientation[0] - 1) < 0.01 && 
                    Math.abs(orientation[4] - 1) < 0.01;
                console.log('Is standard axial orientation:', isStandardAxial);
            }
        }
    } else {
        console.log(`File not found: ${file}`);
    }
});

// Also check the RT Structure file
const rtStructFile = './attached_assets/HN-ATLAS-84/RS.04xy2fKzjzjjQjBsWgs8lrXPI.dcm';
if (fs.existsSync(rtStructFile)) {
    console.log('\n\n=== RT Structure Set Analysis ===');
    const rtMetadata = parseDICOMFile(rtStructFile);
    if (rtMetadata) {
        console.log('Frame of Reference:', rtMetadata.frameOfReferenceUID);
        console.log('Study Description:', rtMetadata.studyDescription);
        console.log('Series Description:', rtMetadata.seriesDescription);
    }
}