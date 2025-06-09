import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DICOMUploader } from '@/components/dicom/dicom-uploader';
import { 
  User, 
  Upload, 
  Search, 
  Eye, 
  Network, 
  Database,
  FileText,
  Calendar,
  Activity
} from 'lucide-react';

interface Patient {
  id: number;
  patientID: string;
  patientName: string;
  patientSex?: string;
  patientAge?: string;
  dateOfBirth?: string;
  createdAt: string;
}

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

export default function PatientManager() {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("patients");
  const queryClient = useQueryClient();

  useEffect(() => {
    const populateDemo = async () => {
      try {
        const response = await fetch("/api/populate-demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (response.ok) {
          queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
          queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
        }
      } catch (error) {
        console.log("Demo data population skipped:", error);
      }
    };
    populateDemo();
  }, [queryClient]);

  const { data: patients = [], isLoading: patientsLoading } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
  });

  const { data: studies = [], isLoading: studiesLoading } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  const filteredPatients = patients.filter(patient =>
    patient.patientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.patientID?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateString: string) => {
    if (!dateString) return "Unknown";
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-5xl font-black tracking-widest mb-2" style={{ letterSpacing: '0.3em' }}>
              <span style={{ color: 'black', WebkitTextStroke: '1px #22c55e', fontWeight: '900' }}>C</span>
              <span style={{ color: 'black', WebkitTextStroke: '1px #10b981', fontWeight: '900' }}>O</span>
              <span style={{ color: 'black', WebkitTextStroke: '1px #3b82f6', fontWeight: '900' }}>N</span>
              <span style={{ color: 'black', WebkitTextStroke: '1px #2563eb', fontWeight: '900' }}>V</span>
              <span style={{ color: 'black', WebkitTextStroke: '1px #6366f1', fontWeight: '900' }}>E</span>
              <span style={{ color: 'black', WebkitTextStroke: '1px #8b5cf6', fontWeight: '900' }}>R</span>
              <span style={{ color: 'black', WebkitTextStroke: '1px #a855f7', fontWeight: '900' }}>G</span>
              <span style={{ color: 'black', WebkitTextStroke: '1px #22c55e', fontWeight: '900' }}>E</span>
            </h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setActiveTab("import")}>
              <Upload className="h-4 w-4 mr-2" />
              Import DICOM
            </Button>
            <Button onClick={() => {
              if (studies.length > 0) {
                window.open(`/dicom-viewer?studyId=${studies[0].id}`, '_blank');
              } else {
                window.open('/dicom-viewer', '_blank');
              }
            }}>
              <Eye className="h-4 w-4 mr-2" />
              Open Viewer
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search patients, studies, or modalities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="patients">
              <User className="h-4 w-4 mr-2" />
              Patients
            </TabsTrigger>
            <TabsTrigger value="import">
              <Upload className="h-4 w-4 mr-2" />
              Import DICOM
            </TabsTrigger>
            <TabsTrigger value="pacs">
              <Network className="h-4 w-4 mr-2" />
              PACS
            </TabsTrigger>
            <TabsTrigger value="query">
              <Database className="h-4 w-4 mr-2" />
              Query
            </TabsTrigger>
          </TabsList>

          {/* COMPLETELY NEW PATIENTS TAB */}
          <TabsContent value="patients">
            {patientsLoading || studiesLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p>Loading patient data...</p>
              </div>
            ) : filteredPatients.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8">
                  <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No patients found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {filteredPatients.map((patient) => {
                  const patientStudies = studies.filter(study => study.patientID === patient.patientID);
                  
                  return (
                    <div key={patient.id} className="bg-white rounded-lg shadow-lg border border-gray-200">
                      {/* Patient Header */}
                      <div className="bg-blue-50 border-b border-blue-200 p-6 rounded-t-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="bg-blue-100 p-3 rounded-full">
                              <User className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                              <h2 className="text-2xl font-bold text-blue-900">
                                {patient.patientName || "Unknown Patient"}
                              </h2>
                              <p className="text-blue-700 font-medium">ID: {patient.patientID}</p>
                              <div className="text-sm text-blue-600 mt-1">
                                {patient.patientSex && `Sex: ${patient.patientSex}`}
                                {patient.patientAge && ` • Age: ${patient.patientAge}`}
                                {patient.dateOfBirth && patient.dateOfBirth !== "Invalid Date" && ` • DOB: ${formatDate(patient.dateOfBirth)}`}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="bg-blue-600 text-white px-4 py-2 rounded-lg mb-2">
                              {patientStudies.length} Studies
                            </div>
                            <div className="bg-blue-100 text-blue-800 px-4 py-1 rounded">
                              {patientStudies.reduce((sum, study) => sum + study.numberOfImages, 0)} Images
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Studies Section */}
                      <div className="p-6">
                        {patientStudies.length === 0 ? (
                          <div className="text-center py-8 bg-gray-50 rounded-lg">
                            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                            <p className="text-gray-500">No studies available for this patient</p>
                          </div>
                        ) : (
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                              <FileText className="h-5 w-5 mr-2" />
                              Studies ({patientStudies.length})
                            </h3>
                            
                            <div className="space-y-4">
                              {patientStudies.map((study) => (
                                <div key={study.id} className="bg-green-50 border border-green-200 rounded-lg p-4 hover:bg-green-100 transition-colors">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-start space-x-3 flex-1">
                                      <div className="bg-green-100 p-2 rounded">
                                        <Activity className="h-4 w-4 text-green-600" />
                                      </div>
                                      <div className="flex-1">
                                        <h4 className="font-semibold text-gray-900 text-lg">
                                          {study.studyDescription || "Unknown Study"}
                                        </h4>
                                        <div className="text-sm text-gray-600 mt-1 space-y-1">
                                          <div className="flex items-center">
                                            <Calendar className="h-4 w-4 mr-2" />
                                            Study Date: {formatDate(study.studyDate)}
                                          </div>
                                          {study.accessionNumber && (
                                            <div>Accession: {study.accessionNumber}</div>
                                          )}
                                          <div className="text-xs text-gray-500">
                                            UID: {study.studyInstanceUID}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    
                                    <div className="flex items-center space-x-4">
                                      <div className="text-right space-y-2">
                                        <div className={`px-3 py-1 rounded text-sm font-semibold ${
                                          study.modality === 'CT' ? 'bg-blue-100 text-blue-800' :
                                          study.modality === 'MR' ? 'bg-green-100 text-green-800' :
                                          study.modality === 'RTSTRUCT' ? 'bg-purple-100 text-purple-800' :
                                          study.modality === 'RTPLAN' ? 'bg-orange-100 text-orange-800' :
                                          study.modality === 'RTDOSE' ? 'bg-red-100 text-red-800' :
                                          'bg-gray-100 text-gray-800'
                                        }`}>
                                          {study.modality}
                                        </div>
                                        <div className="flex space-x-2 text-xs">
                                          <span className="bg-gray-100 px-2 py-1 rounded">
                                            {study.numberOfSeries} series
                                          </span>
                                          <span className="bg-gray-100 px-2 py-1 rounded">
                                            {study.numberOfImages} images
                                          </span>
                                        </div>
                                      </div>
                                      
                                      <Button
                                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2"
                                        onClick={() => {
                                          window.open(`/dicom-viewer?studyId=${study.id}`, '_blank');
                                        }}
                                      >
                                        <Eye className="h-4 w-4 mr-2" />
                                        View Study
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="import">
            <Card>
              <CardHeader>
                <CardTitle>Import DICOM Files</CardTitle>
              </CardHeader>
              <CardContent>
                <DICOMUploader />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pacs">
            <Card>
              <CardHeader>
                <CardTitle>PACS Connections</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">PACS integration coming soon...</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="query">
            <Card>
              <CardHeader>
                <CardTitle>DICOM Query</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">DICOM query functionality coming soon...</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}