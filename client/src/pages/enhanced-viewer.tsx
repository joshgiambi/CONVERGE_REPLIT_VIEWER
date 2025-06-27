import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ViewerInterface } from '@/components/dicom/viewer-interface';

export default function EnhancedViewer() {
  const [studyData, setStudyData] = useState<any>(null);
  
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
  
  if (!studyData) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white">Loading enhanced viewer...</div>
      </div>
    );
  }
  
  return <ViewerInterface studyData={studyData} />;
}