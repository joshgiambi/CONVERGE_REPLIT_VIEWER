import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, User, Calendar, FileText, Eye, Activity } from "lucide-react";
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

function PatientManagerFinal() {
  const [, setLocation] = useLocation();

  // Force cache invalidation
  useEffect(() => {
    // Clear all React Query cache
    const queryClient = (window as any).queryClient;
    if (queryClient) {
      queryClient.clear();
    }
    // Force page reload if old interface is detected
    const oldElements = document.querySelectorAll('[data-old-interface]');
    if (oldElements.length > 0) {
      window.location.reload();
    }
  }, []);

  const { data: patients, isLoading } = useQuery({
    queryKey: ['/api/patients', Date.now()],
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
  }) as { data: Patient[] | undefined, isLoading: boolean };

  const getModalityColor = (modality: string | null) => {
    switch (modality?.toUpperCase()) {
      case 'CT': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'MR': return 'bg-green-100 text-green-800 border-green-200';
      case 'RTSTRUCT': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'RTDOSE': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'RTPLAN': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  };

  const handleViewStudy = (studyId: number) => {
    setLocation(`/dicom-viewer?studyId=${studyId}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <Activity className="mx-auto h-8 w-8 animate-spin text-blue-600 mb-4" />
            <p className="text-gray-600">Loading patient data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header - Force Unique Rendering */}
      <div className="bg-white border-b border-gray-200 shadow-sm" data-new-interface="true">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
                CONVERGE
              </h1>
              <p className="text-gray-600 mt-1">Medical DICOM Imaging Platform - New Interface {Date.now()}</p>
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
        <Tabs defaultValue="patients" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="patients">Patients</TabsTrigger>
            <TabsTrigger value="studies">Studies</TabsTrigger>
            <TabsTrigger value="upload">Upload</TabsTrigger>
          </TabsList>

          <TabsContent value="patients" className="space-y-6">
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
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600">
                                      <div className="flex items-center">
                                        <Calendar className="mr-1 h-3 w-3" />
                                        {formatDate(study.studyDate)}
                                      </div>
                                      <div>Series: {study.numberOfSeries || 0}</div>
                                      <div>Images: {study.numberOfImages || 0}</div>
                                      <div>Acc#: {study.accessionNumber || 'N/A'}</div>
                                    </div>
                                  </div>
                                  <Button 
                                    onClick={() => handleViewStudy(study.id)}
                                    className="ml-4 bg-green-600 hover:bg-green-700"
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
              <Card className="text-center py-12">
                <CardContent>
                  <User className="mx-auto h-16 w-16 text-gray-400 mb-4" />
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">No Patients Found</h3>
                  <p className="text-gray-500 mb-4">Upload DICOM files to begin managing patients and studies.</p>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Upload className="mr-2 h-4 w-4" />
                    Upload DICOM Files
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="studies">
            <Card>
              <CardContent className="p-6">
                <p className="text-gray-600">Studies view coming soon...</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="upload">
            <Card>
              <CardContent className="p-6">
                <p className="text-gray-600">Upload functionality coming soon...</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default PatientManagerFinal;