import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UploadZone } from '@/components/dicom/upload-zone';
import { ViewerInterface } from '@/components/dicom/viewer-interface';
import { Download, User, Calendar } from 'lucide-react';

export default function DICOMViewer() {
  const [studyData, setStudyData] = useState<any>(null);
  const [currentPatient, setCurrentPatient] = useState<any>(null);

  const handleUploadComplete = (data: any) => {
    setStudyData(data);
    
    // Set patient info from first study
    if (data.studies?.length > 0) {
      const firstStudy = data.studies[0];
      setCurrentPatient({
        name: firstStudy.patientName || 'Unknown Patient',
        id: firstStudy.patientID || 'Unknown ID',
        studyDate: firstStudy.studyDate || ''
      });
    }
  };

  const handleExportStudy = () => {
    console.log('Export study functionality would be implemented here');
    // In a real application, this would trigger a download of the study data
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown Date';
    
    try {
      // DICOM dates are in YYYYMMDD format
      if (dateString.length === 8) {
        const year = dateString.substring(0, 4);
        const month = dateString.substring(4, 6);
        const day = dateString.substring(6, 8);
        const date = new Date(`${year}-${month}-${day}`);
        return date.toLocaleDateString();
      }
      
      return new Date(dateString).toLocaleDateString();
    } catch (error) {
      return dateString;
    }
  };

  return (
    <div className="min-h-screen bg-dicom-black text-white">
      {/* Header */}
      <header className="bg-dicom-dark border-b border-dicom-gray p-4 sticky top-0 z-40 backdrop-blur-sm">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-dicom-yellow rounded-lg flex items-center justify-center">
              <svg 
                className="w-6 h-6 text-black" 
                fill="currentColor" 
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-dicom-yellow">DICOM Viewer</h1>
              <p className="text-sm text-gray-400">Medical Imaging Platform</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Patient Info */}
            {currentPatient && (
              <div className="hidden md:flex items-center space-x-2 text-sm bg-dicom-darker rounded-lg px-4 py-2">
                <User className="w-4 h-4 text-dicom-yellow" />
                <span className="text-white">Patient: {currentPatient.name}</span>
                <span className="text-dicom-gray">|</span>
                <Calendar className="w-4 h-4 text-dicom-yellow" />
                <span className="text-white">Study: {formatDate(currentPatient.studyDate)}</span>
              </div>
            )}
            
            {studyData && (
              <Button 
                onClick={handleExportStudy}
                className="bg-dicom-yellow text-black hover:bg-dicom-yellow/90 transition-all duration-200 hover:scale-105"
              >
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-4 max-w-7xl mx-auto">
        {!studyData ? (
          /* Upload Section */
          <div className="max-w-4xl mx-auto py-16">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-dicom-yellow mb-4">
                Medical Imaging Viewer
              </h2>
              <p className="text-gray-400 text-lg">
                Upload and analyze DICOM studies with multi-planar reconstruction
              </p>
            </div>
            
            <UploadZone onUploadComplete={handleUploadComplete} />
            
            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <Card className="bg-dicom-dark/50 border-dicom-gray p-6">
                <div className="w-12 h-12 bg-dicom-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-dicom-yellow" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Native DICOM</h3>
                <p className="text-gray-400 text-sm">
                  True DICOM rendering with no conversion or quality loss
                </p>
              </Card>
              
              <Card className="bg-dicom-dark/50 border-dicom-gray p-6">
                <div className="w-12 h-12 bg-dicom-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-dicom-yellow" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Multi-Planar</h3>
                <p className="text-gray-400 text-sm">
                  Synchronized axial, sagittal, and coronal views
                </p>
              </Card>
              
              <Card className="bg-dicom-dark/50 border-dicom-gray p-6">
                <div className="w-12 h-12 bg-dicom-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-dicom-yellow" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Fast Processing</h3>
                <p className="text-gray-400 text-sm">
                  Optimized for large datasets with efficient memory usage
                </p>
              </Card>
            </div>
          </div>
        ) : (
          /* Viewer Interface */
          <ViewerInterface studyData={studyData} />
        )}
      </main>
    </div>
  );
}
