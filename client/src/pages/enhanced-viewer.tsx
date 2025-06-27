import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ViewerInterface } from '@/components/dicom/viewer-interface';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Home, Download } from 'lucide-react';

export default function EnhancedViewer() {
  const [studyData, setStudyData] = useState<any>(null);
  const [, setLocation] = useLocation();
  
  const { data: studies } = useQuery({
    queryKey: ['/api/studies'],
    queryFn: () => fetch('/api/studies').then(res => res.json())
  });
  
  useEffect(() => {
    if (studies && studies.length > 0) {
      const studyId = new URLSearchParams(window.location.search).get('studyId');
      const study = studyId ? studies.find((s: any) => s.id === parseInt(studyId)) : studies[0];
      if (study) {
        setStudyData({ studies: [study] });
      }
    }
  }, [studies]);

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown Date';
    
    try {
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

  if (!studyData) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white">Loading enhanced viewer...</div>
      </div>
    );
  }

  const currentStudy = studyData.studies[0];

  return (
    <div className="min-h-screen bg-dicom-black text-white">
      {/* Enhanced Viewer Header */}
      <header className="fixed top-4 left-4 right-4 bg-dicom-dark/80 backdrop-blur-md border border-green-500/30 rounded-2xl px-6 py-3 z-50 shadow-xl animate-slide-up">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center space-x-4">
            <div>
              <h1 className="text-xl font-black tracking-widest" style={{ letterSpacing: '0.25em' }}>
                <span style={{
                  color: 'white',
                  WebkitTextStroke: '1px #22c55e',
                  fontWeight: '900'
                }}>C</span>
                <span style={{
                  color: 'white',
                  WebkitTextStroke: '1px #10b981',
                  fontWeight: '900'
                }}>O</span>
                <span style={{
                  color: 'white',
                  WebkitTextStroke: '1px #3b82f6',
                  fontWeight: '900'
                }}>N</span>
                <span style={{
                  color: 'white',
                  WebkitTextStroke: '1px #2563eb',
                  fontWeight: '900'
                }}>V</span>
                <span style={{
                  color: 'white',
                  WebkitTextStroke: '1px #1d4ed8',
                  fontWeight: '900'
                }}>E</span>
                <span style={{
                  color: 'white',
                  WebkitTextStroke: '1px #1e40af',
                  fontWeight: '900'
                }}>R</span>
                <span style={{
                  color: 'white',
                  WebkitTextStroke: '1px #1e3a8a',
                  fontWeight: '900'
                }}>G</span>
                <span style={{
                  color: 'white',
                  WebkitTextStroke: '1px #312e81',
                  fontWeight: '900'
                }}>E</span>
              </h1>
              <p className="text-green-400 text-xs mt-1 font-medium">Enhanced RT Structure Viewer</p>
            </div>
            
            {currentStudy && (
              <div className="flex items-center space-x-3 pl-4 border-l border-gray-600">
                <div>
                  <h2 className="text-sm font-semibold text-dicom-yellow">{currentStudy.patientName}</h2>
                  <p className="text-xs text-gray-400">
                    {currentStudy.studyDescription} • {formatDate(currentStudy.studyDate)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/')}
              className="text-white hover:bg-white/10"
            >
              <Home className="h-4 w-4 mr-2" />
              Home
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.history.back()}
              className="text-white hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="pt-24 pb-8 px-4">
        <ViewerInterface studyData={studyData} />
      </div>
    </div>
  );
}