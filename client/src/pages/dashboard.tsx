import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, FileText, Upload, Eye, Calendar } from "lucide-react";
import { useLocation } from "wouter";

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
  const [, setLocation] = useLocation();

  const { data: patients, isLoading } = useQuery({
    queryKey: ['/api/patients'],
  }) as { data: Patient[] | undefined, isLoading: boolean };

  const getModalityColor = (modality: string | null) => {
    switch (modality?.toUpperCase()) {
      case 'CT': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'MR': return 'bg-green-100 text-green-800 border-green-200';
      case 'RTSTRUCT': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'RTPLAN': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'RTDOSE': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleViewStudy = (studyId: number) => {
    setLocation(`/dicom-viewer?studyId=${studyId}`);
  };

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
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Upload className="mr-2 h-4 w-4" />
              Upload DICOM
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6">
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Patients</h2>
          
          {patients && patients.length > 0 ? (
            <div className="space-y-6">
              {patients.map((patient: Patient) => (
                <Card key={patient.id} className="border-l-4 border-l-blue-500 shadow-lg hover:shadow-xl transition-shadow">
                  <CardHeader className="bg-blue-50 border-b">
                    <CardTitle className="flex items-center text-blue-900">
                      <User className="mr-3 h-5 w-5" />
                      <div>
                        <div className="text-xl font-semibold">
                          {patient.patientName || 'Unknown Patient'}
                        </div>
                        <div className="text-sm text-blue-700 font-normal">
                          ID: {patient.patientID || 'N/A'}
                        </div>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    <div className="space-y-4">
                      <h4 className="font-semibold text-gray-700 mb-3">Studies ({patient.studies.length})</h4>
                      <div className="grid gap-4">
                        {patient.studies.map((study: Study) => (
                          <Card key={study.id} className="border-l-4 border-l-green-500 bg-green-50">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-3 mb-2">
                                    <FileText className="h-4 w-4 text-green-700" />
                                    <h5 className="font-semibold text-green-900">
                                      {study.studyDescription || 'Unnamed Study'}
                                    </h5>
                                    <Badge className={`${getModalityColor(study.modality)} text-xs`}>
                                      {study.modality || 'Unknown'}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-4 text-sm text-gray-600">
                                    <div className="flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />
                                      {study.studyDate ? new Date(study.studyDate).toLocaleDateString() : 'Unknown Date'}
                                    </div>
                                    <div>{study.numberOfSeries || 0} series</div>
                                    <div>{study.numberOfImages || 0} images</div>
                                    {study.accessionNumber && (
                                      <div>Acc: {study.accessionNumber}</div>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  onClick={() => handleViewStudy(study.id)}
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                  <Eye className="mr-2 h-4 w-4" />
                                  View Study
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <User className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No patients found</h3>
              <p className="text-gray-600">Upload DICOM files to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;