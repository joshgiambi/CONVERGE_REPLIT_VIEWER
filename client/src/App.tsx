import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const url = queryKey[0] as string;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      },
    },
  },
});

interface Patient {
  id: number;
  patientID: string | null;
  patientName: string | null;
  studies: Study[];
}

interface Study {
  id: number;
  studyInstanceUID: string;
  studyDate: string | null;
  studyDescription: string | null;
  modality: string | null;
  numberOfSeries: number | null;
  numberOfImages: number | null;
  accessionNumber: string | null;
}

function Dashboard() {
  const [currentTab, setCurrentTab] = useState('patients');
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data: patients, isLoading } = useQuery({
    queryKey: ['/api/patients'],
  }) as { data: Patient[] | undefined, isLoading: boolean };

  const handleViewStudy = (studyId: number) => {
    // Navigate to DICOM viewer with study ID
    window.location.href = `/dicom-viewer?studyId=${studyId}`;
  };

  const filteredPatients = patients?.filter(patient => 
    patient.patientName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    patient.patientID?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    patient.studies.some(study => 
      study.studyDescription?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      study.modality?.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
                CONVERGE
              </h1>
              <p className="text-gray-600 mt-1">Medical DICOM Imaging Platform</p>
            </div>
            <div className="flex items-center gap-4">
              <button className="bg-yellow-500 hover:bg-yellow-600 text-black px-4 py-2 rounded-lg font-medium">
                Open Viewer
              </button>
              <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium">
                Import DICOM
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search patients, studies, or modalities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-gray-900 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex space-x-8">
            {[
              { id: 'patients', label: 'Patients', icon: '👤' },
              { id: 'import', label: 'Import DICOM', icon: '📤' },
              { id: 'pacs', label: 'PACS', icon: '🏥' },
              { id: 'query', label: 'Query', icon: '🔍' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCurrentTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  currentTab === tab.id
                    ? 'border-blue-400 text-blue-400'
                    : 'border-transparent text-gray-400 hover:text-gray-300'
                }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6">
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Patients</h2>
          
          {currentTab === 'patients' && filteredPatients && filteredPatients.length > 0 ? (
            <div className="space-y-6">
              {filteredPatients.map((patient: Patient) => (
                <div key={patient.id} className="bg-white border-l-4 border-l-blue-500 shadow-lg rounded-lg overflow-hidden hover:shadow-xl transition-shadow">
                  <div className="bg-blue-50 border-b px-6 py-4">
                    <div className="flex items-center text-blue-900">
                      <svg className="mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <div>
                        <div className="text-xl font-semibold">
                          {patient.patientName || 'Unknown Patient'}
                        </div>
                        <div className="text-sm text-blue-700 font-normal">
                          ID: {patient.patientID || 'N/A'}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold text-gray-700 mb-3">Studies ({patient.studies.length})</h4>
                      <div className="grid gap-4">
                        {patient.studies.map((study: Study) => (
                          <div key={study.id} className="bg-green-50 border-l-4 border-l-green-500 rounded-lg overflow-hidden">
                            <div className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-3 mb-2">
                                    <svg className="h-4 w-4 text-green-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    <h5 className="font-semibold text-green-900">
                                      {study.studyDescription || 'Unnamed Study'}
                                    </h5>
                                    <span className="bg-blue-100 text-blue-800 border border-blue-200 text-xs px-2 py-1 rounded">
                                      {study.modality || 'Unknown'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-4 text-sm text-gray-600">
                                    <div className="flex items-center gap-1">
                                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                      {study.studyDate ? new Date(study.studyDate).toLocaleDateString() : 'Unknown Date'}
                                    </div>
                                    <div>{study.numberOfSeries || 0} series</div>
                                    <div>{study.numberOfImages || 0} images</div>
                                    {study.accessionNumber && (
                                      <div>Acc: {study.accessionNumber}</div>
                                    )}
                                  </div>
                                </div>
                                <button 
                                  onClick={() => handleViewStudy(study.id)}
                                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"
                                >
                                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                  View Study
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No patients found</h3>
              <p className="text-gray-600">Upload DICOM files to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}

export default App;