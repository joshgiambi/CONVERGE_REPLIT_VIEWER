import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { EnhancedViewerWithContours } from '@/components/dicom/enhanced-viewer-with-contours';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export function ContourEditorPage() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(location.split('?')[1] || '');
  const seriesId = parseInt(searchParams.get('seriesId') || '0');
  const studyId = parseInt(searchParams.get('studyId') || '0');

  // Load RT structures for the study
  const { data: rtStructures = [], isLoading: structuresLoading } = useQuery({
    queryKey: ['/api/studies', studyId, 'rt-structures'],
    enabled: !!studyId
  });

  if (!seriesId || !studyId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Invalid Parameters</h2>
          <p className="text-gray-600 mb-4">Please provide valid series and study IDs.</p>
          <Button onClick={() => window.history.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  if (structuresLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading structures...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen">
      <EnhancedViewerWithContours
        seriesId={seriesId}
        studyId={studyId}
        rtStructures={rtStructures}
      />
    </div>
  );
}