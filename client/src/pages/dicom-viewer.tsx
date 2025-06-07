import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UploadZone } from '@/components/dicom/upload-zone';
import { ViewerInterface } from '@/components/dicom/viewer-interface';
import { Download, User, Calendar, Home, ArrowLeft } from 'lucide-react';

interface Study {
  id: number;
  studyInstanceUID: string;
  patientId: number;
  patientName: string;
  patientID: string;
  studyDate: string;
  studyDescription: string;
  accessionNumber?: string;
  modality: string;
  numberOfSeries: number;
  numberOfImages: number;
  isDemo: boolean;
  createdAt: string;
}

interface SeriesData {
  id: number;
  studyId: number;
  seriesInstanceUID: string;
  seriesDescription: string;
  modality: string;
  seriesNumber: number;
  imageCount: number;
  sliceThickness: string;
  metadata: any;
  createdAt: string;
}

export default function DICOMViewer() {
  const [studyData, setStudyData] = useState<any>(null);
  const [currentPatient, setCurrentPatient] = useState<any>(null);
  const [location, navigate] = useLocation();

  // Extract studyId from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const studyId = urlParams.get('studyId');

  // Fetch study data if studyId is provided
  const { data: study, isLoading: studyLoading } = useQuery<Study>({
    queryKey: [`/api/studies/${studyId}`],
    queryFn: async () => {
      const response = await fetch(`/api/studies/${studyId}`);
      if (!response.ok) throw new Error('Failed to fetch study');
      return response.json();
    },
    enabled: !!studyId,
  });

  // Fetch series data for the study
  const { data: seriesData, isLoading: seriesLoading } = useQuery<SeriesData[]>({
    queryKey: [`/api/studies/${studyId}/series`],
    queryFn: async () => {
      const response = await fetch(`/api/studies/${studyId}/series`);
      if (!response.ok) throw new Error('Failed to fetch series');
      return response.json();
    },
    enabled: !!studyId,
  });

  useEffect(() => {
    if (study && seriesData) {
      // Transform API data to match expected format
      const transformedData = {
        studies: [study],
        series: seriesData
      };
      setStudyData(transformedData);
      
      setCurrentPatient({
        name: study.patientName || 'Unknown Patient',
        id: study.patientID || 'Unknown ID',
        studyDate: study.studyDate || ''
      });
    }
  }, [study, seriesData]);

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
      {/* Floating Header */}
      <header className="fixed top-4 left-4 right-4 bg-dicom-dark/80 backdrop-blur-md border border-dicom-indigo/30 rounded-2xl px-6 py-3 z-50 shadow-xl animate-slide-up">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center space-x-4">
            <div>
              <h1 className="text-lg font-black tracking-wide flex items-center">
                <span className="text-white border-2 border-red-500 rounded px-1 mx-0.5">C</span>
                <span className="text-white border-2 border-orange-500 rounded px-1 mx-0.5">O</span>
                <span className="text-white border-2 border-yellow-500 rounded px-1 mx-0.5">N</span>
                <span className="text-white border-2 border-green-500 rounded px-1 mx-0.5">D</span>
                <span className="text-white border-2 border-blue-500 rounded px-1 mx-0.5">U</span>
                <span className="text-white border-2 border-indigo-500 rounded px-1 mx-0.5">I</span>
                <span className="text-white border-2 border-purple-500 rounded px-1 mx-0.5">T</span>
              </h1>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            {/* Back to Patient Manager Button */}
            <Button 
              onClick={() => navigate('/')}
              variant="outline"
              size="sm"
              className="border-dicom-indigo text-dicom-indigo hover:bg-gradient-primary hover:text-white hover:border-transparent transition-all duration-300"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Patient Manager
            </Button>
            
            {/* Patient Info */}
            {currentPatient && (
              <div className="hidden md:flex items-center space-x-2 text-sm bg-dicom-darker/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-dicom-blue/20">
                <User className="w-3 h-3 text-dicom-yellow" />
                <span className="text-white text-xs">{currentPatient.name}</span>
                <span className="text-dicom-gray">|</span>
                <Calendar className="w-3 h-3 text-dicom-blue" />
                <span className="text-white text-xs">{formatDate(currentPatient.studyDate)}</span>
              </div>
            )}
            
            {studyData && (
              <Button 
                onClick={handleExportStudy}
                size="sm"
                className="btn-animated text-white font-medium"
              >
                <Download className="w-4 h-4 mr-1" />
                Export
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-24 px-6">
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
