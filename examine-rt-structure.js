import dicomParser from 'dicom-parser';
import fs from 'fs';

// Function to parse RT Structure Set
function parseRTStructure(filePath) {
    try {
        const dicomFileAsBuffer = fs.readFileSync(filePath);
        const byteArray = new Uint8Array(dicomFileAsBuffer);
        const dataSet = dicomParser.parseDicom(byteArray);

        console.log('=== RT Structure Set Metadata ===');
        console.log('Frame of Reference UID:', dataSet.string('x00200052'));
        console.log('Structure Set Label:', dataSet.string('x30060002'));
        console.log('Structure Set Name:', dataSet.string('x30060004'));
        console.log('Structure Set Date:', dataSet.string('x30060008'));
        console.log('Structure Set Time:', dataSet.string('x30060009'));

        // Get ROI Contour Sequence
        const roiContourSequence = dataSet.elements.x30060039;
        if (roiContourSequence && roiContourSequence.items) {
            console.log('\nNumber of ROI Contours:', roiContourSequence.items.length);

            // Look at first few structures
            for (let i = 0; i < Math.min(3, roiContourSequence.items.length); i++) {
                const roiContour = roiContourSequence.items[i].dataSet;
                const referencedROINumber = roiContour.string('x30060084');
                
                console.log(`\n--- ROI Contour ${i + 1} (ROI Number: ${referencedROINumber}) ---`);
                
                // Get contour sequence
                const contourSequence = roiContour.elements.x30060040;
                if (contourSequence && contourSequence.items) {
                    console.log('Number of contour slices:', contourSequence.items.length);
                    
                    // Look at first contour
                    const firstContour = contourSequence.items[0].dataSet;
                    const contourGeometricType = firstContour.string('x30060042');
                    const numberOfContourPoints = firstContour.int32('x30060046');
                    const contourData = firstContour.string('x30060050');
                    
                    console.log('First contour geometric type:', contourGeometricType);
                    console.log('Number of contour points:', numberOfContourPoints);
                    
                    if (contourData) {
                        const points = contourData.split('\\').map(Number);
                        console.log('First 9 coordinates (3 points):');
                        for (let j = 0; j < Math.min(9, points.length); j += 3) {
                            console.log(`  Point ${j/3 + 1}: X=${points[j].toFixed(2)}, Y=${points[j+1].toFixed(2)}, Z=${points[j+2].toFixed(2)}`);
                        }
                        
                        // Analyze coordinate ranges
                        const xCoords = [];
                        const yCoords = [];
                        const zCoords = [];
                        for (let j = 0; j < points.length; j += 3) {
                            xCoords.push(points[j]);
                            yCoords.push(points[j+1]);
                            zCoords.push(points[j+2]);
                        }
                        
                        console.log('X range:', Math.min(...xCoords).toFixed(2), 'to', Math.max(...xCoords).toFixed(2));
                        console.log('Y range:', Math.min(...yCoords).toFixed(2), 'to', Math.max(...yCoords).toFixed(2));
                        console.log('Z value:', zCoords[0].toFixed(2));
                    }
                }
            }
        }

        // Get Structure Set ROI Sequence to map ROI numbers to names
        const structureSetROISequence = dataSet.elements.x30060020;
        if (structureSetROISequence && structureSetROISequence.items) {
            console.log('\n=== ROI Names ===');
            for (let i = 0; i < Math.min(5, structureSetROISequence.items.length); i++) {
                const roi = structureSetROISequence.items[i].dataSet;
                const roiNumber = roi.int32('x30060022');
                const roiName = roi.string('x30060026');
                console.log(`ROI ${roiNumber}: ${roiName}`);
            }
        }

    } catch (error) {
        console.error('Error parsing RT Structure:', error.message);
    }
}

// Parse the RT Structure file
const rtStructFile = './attached_assets/HN-ATLAS-84/RS.04xy2fKzjzjjQjBsWgs8lrXPI.dcm';
if (fs.existsSync(rtStructFile)) {
    parseRTStructure(rtStructFile);
} else {
    console.log('RT Structure file not found:', rtStructFile);
}