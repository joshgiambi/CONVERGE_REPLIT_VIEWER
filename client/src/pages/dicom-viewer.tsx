import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

interface DICOMViewerProps {
  studyId?: string;
}

function DICOMViewer() {
  const [studyId, setStudyId] = useState<string | null>(null);

  useEffect(() => {
    // Get study ID from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('studyId');
    setStudyId(id);
  }, []);

  const { data: study, isLoading } = useQuery({
    queryKey: [`/api/studies/${studyId}`],
    enabled: !!studyId,
  });

  const { data: series } = useQuery({
    queryKey: [`/api/studies/${studyId}/series`],
    enabled: !!studyId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Loading DICOM Viewer...</div>
      </div>
    );
  }

  if (!studyId) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">No study selected</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              CONVERGE DICOM Viewer
            </h1>
            {study && (
              <p className="text-gray-300 mt-1">
                {study.studyDescription} - {study.modality}
              </p>
            )}
          </div>
          <button 
            onClick={() => window.location.href = '/'}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
          >
            Back to Dashboard
          </button>
        </div>
      </div>

      {/* Viewer Content */}
      <div className="flex h-screen">
        {/* Sidebar with series */}
        <div className="w-80 bg-gray-900 border-r border-gray-700 p-4">
          <h3 className="text-lg font-semibold mb-4">Series</h3>
          {series && series.length > 0 ? (
            <div className="space-y-2">
              {series.map((s: any, index: number) => (
                <div key={s.id} className="bg-gray-800 p-3 rounded-lg cursor-pointer hover:bg-gray-700">
                  <div className="font-medium">Series {index + 1}</div>
                  <div className="text-sm text-gray-400">
                    {s.seriesDescription || 'Unnamed Series'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {s.images?.length || 0} images
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-400">No series found</div>
          )}
        </div>

        {/* Main viewer area */}
        <div className="flex-1 bg-black flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-4">🏥</div>
            <h2 className="text-2xl font-bold mb-2">DICOM Viewer</h2>
            <p className="text-gray-400 mb-4">
              Study ID: {studyId}
            </p>
            <p className="text-gray-400">
              DICOM viewer functionality will be implemented here.
              This will include image rendering, MPR views, and measurement tools.
            </p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4">
        <div className="flex items-center justify-center space-x-4">
          <button className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded">
            Zoom
          </button>
          <button className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded">
            Pan
          </button>
          <button className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded">
            Window/Level
          </button>
          <button className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded">
            Measure
          </button>
          <button className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded">
            MPR
          </button>
        </div>
      </div>
    </div>
  );
}

export default DICOMViewer;