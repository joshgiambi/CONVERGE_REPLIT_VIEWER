/**
 * ViewerV2 Page
 * 
 * Route handler for new refactored viewer
 * URL: /viewer-v2?patientId=X&seriesId=Y
 * 
 * Agent 1: Viewer Core
 * Created: Hour 16-18
 */

import { useLocation } from 'wouter';
import { ViewerV2 } from '@/components/viewer/ViewerV2';
import { useQuery } from '@tanstack/react-query';

export default function ViewerV2Page() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(location.split('?')[1]);
  
  const patientId = searchParams.get('patientId');
  const seriesIdParam = searchParams.get('seriesId');
  const studyId = searchParams.get('studyId');

  // If no seriesId provided, fetch patient's series and use the first one
  const { data: patientData, isLoading } = useQuery({
    queryKey: ['patient-series', patientId],
    queryFn: async () => {
      if (!patientId || seriesIdParam) return null;
      const response = await fetch(`/api/patients/${patientId}/series`);
      if (!response.ok) throw new Error('Failed to fetch series');
      return response.json();
    },
    enabled: !!patientId && !seriesIdParam,
  });

  // Use provided seriesId or fall back to first series from patient
  const seriesId = seriesIdParam || patientData?.[0]?.id;

  if (!patientId) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">ViewerV2</h1>
          <p className="text-gray-400">Missing patientId parameter</p>
          <p className="text-sm text-gray-500 mt-2">
            Usage: /viewer-v2?patientId=1 or /viewer-v2?patientId=1&seriesId=123
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">ViewerV2</h1>
          <p className="text-gray-400">Loading patient data...</p>
        </div>
      </div>
    );
  }

  if (!seriesId) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">ViewerV2</h1>
          <p className="text-gray-400">No series found for this patient</p>
          <p className="text-sm text-gray-500 mt-2">
            Patient ID: {patientId}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ViewerV2
      patientId={patientId}
      seriesId={parseInt(seriesId, 10)}
      studyId={studyId ? parseInt(studyId, 10) : undefined}
    />
  );
}

