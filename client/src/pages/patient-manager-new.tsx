import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
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
  Download,
  Activity
} from 'lucide-react';

// Types
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

interface PacsConnection {
  id: number;
  name: string;
  aeTitle: string;
  hostname: string;
  port: number;
  callingAeTitle: string;
  protocol: string;
  wadoUri?: string;
  qidoUri?: string;
  stowUri?: string;
  isActive: boolean;
  createdAt: string;
}

interface DICOMQueryResult {
  patientName?: string;
  patientID?: string;
  studyInstanceUID?: string;
  studyDate?: string;
  studyTime?: string;
  studyDescription?: string;
  accessionNumber?: string;
  modality?: string;
  numberOfStudyRelatedSeries?: number;
  numberOfStudyRelatedInstances?: number;
}

// Validation schemas
const pacsConnectionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  aeTitle: z.string().min(1, "AE Title is required"),
  hostname: z.string().min(1, "Hostname is required"),
  port: z.number().min(1).max(65535),
  callingAeTitle: z.string().min(1, "Calling AE Title is required"),
  protocol: z.enum(["DICOM", "DICOMweb"]),
  wadoUri: z.string().optional(),
  qidoUri: z.string().optional(),
  stowUri: z.string().optional(),
});

const querySchema = z.object({
  patientName: z.string().optional(),
  patientID: z.string().optional(),
  studyDate: z.string().optional(),
  studyDescription: z.string().optional(),
  accessionNumber: z.string().optional(),
  modality: z.string().optional(),
});

export default function PatientManager() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPacs, setSelectedPacs] = useState<number | null>(null);
  const [queryResults, setQueryResults] = useState<DICOMQueryResult[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [activeTab, setActiveTab] = useState("patients");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Auto-populate demo data on component mount
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

  // Fetch patients
  const { data: patients = [], isLoading: patientsLoading } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
  });

  // Fetch studies
  const { data: studies = [], isLoading: studiesLoading } = useQuery<Study[]>({
    queryKey: ["/api/studies"],
  });

  // Fetch PACS connections
  const { data: pacsConnections = [], isLoading: pacsLoading } = useQuery<PacsConnection[]>({
    queryKey: ["/api/pacs"],
  });

  // Filter patients
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
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-indigo-900">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-5xl font-black tracking-widest mb-2" style={{ letterSpacing: '0.3em' }}>
              <span style={{
                color: 'black',
                WebkitTextStroke: '1px #22c55e',
                fontWeight: '900'
              }}>C</span>
              <span style={{
                color: 'black',
                WebkitTextStroke: '1px #10b981',
                fontWeight: '900'
              }}>O</span>
              <span style={{
                color: 'black',
                WebkitTextStroke: '1px #3b82f6',
                fontWeight: '900'
              }}>N</span>
              <span style={{
                color: 'black',
                WebkitTextStroke: '1px #2563eb',
                fontWeight: '900'
              }}>V</span>
              <span style={{
                color: 'black',
                WebkitTextStroke: '1px #6366f1',
                fontWeight: '900'
              }}>E</span>
              <span style={{
                color: 'black',
                WebkitTextStroke: '1px #8b5cf6',
                fontWeight: '900'
              }}>R</span>
              <span style={{
                color: 'black',
                WebkitTextStroke: '1px #a855f7',
                fontWeight: '900'
              }}>G</span>
              <span style={{
                color: 'black',
                WebkitTextStroke: '1px #22c55e',
                fontWeight: '900'
              }}>E</span>
            </h1>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline"
              onClick={() => setActiveTab("import")}
            >
              <Upload className="h-4 w-4 mr-2" />
              Import DICOM
            </Button>
            <Button 
              onClick={() => {
                // Open the first available study in the viewer
                if (studies.length > 0) {
                  window.open(`/dicom-viewer?studyId=${studies[0].id}`, '_blank');
                } else {
                  window.open('/dicom-viewer', '_blank');
                }
              }}
            >
              <Eye className="h-4 w-4 mr-2" />
              Open Viewer
            </Button>
          </div>
        </div>

        {/* Search Bar */}
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
            <TabsTrigger value="patients" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Patients
            </TabsTrigger>
            <TabsTrigger value="import" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import DICOM
            </TabsTrigger>
            <TabsTrigger value="pacs" className="flex items-center gap-2">
              <Network className="h-4 w-4" />
              PACS
            </TabsTrigger>
            <TabsTrigger value="query" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Query
            </TabsTrigger>
          </TabsList>

          {/* NEW HIERARCHICAL PATIENTS TAB */}
          <TabsContent value="patients" className="space-y-4">
            {patientsLoading || studiesLoading ? (
              <div className="text-center py-8">Loading patient data...</div>
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
                    <Card key={patient.id} className="border-l-4 border-l-blue-500 shadow-lg">
                      <CardHeader className="bg-blue-50/50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <User className="h-6 w-6 text-blue-600" />
                            <div>
                              <CardTitle className="text-2xl font-bold text-blue-900">
                                {patient.patientName || "Unknown Patient"}
                              </CardTitle>
                              <div className="text-blue-700 font-medium mt-1">
                                Patient ID: {patient.patientID}
                              </div>
                              <div className="text-sm text-blue-600 mt-1">
                                {patient.patientSex && `Sex: ${patient.patientSex}`}
                                {patient.patientAge && ` • Age: ${patient.patientAge}`}
                                {patient.dateOfBirth && patient.dateOfBirth !== "Invalid Date" && ` • DOB: ${formatDate(patient.dateOfBirth)}`}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            <Badge className="bg-blue-100 text-blue-800 border-blue-300">
                              {patientStudies.length} Studies
                            </Badge>
                            <Badge variant="outline" className="border-blue-300">
                              {patientStudies.reduce((sum, study) => sum + study.numberOfImages, 0)} Images
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      
                      <CardContent className="pt-6">
                        {patientStudies.length === 0 ? (
                          <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
                            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                            <p>No studies available for this patient</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                              <FileText className="h-5 w-5" />
                              Studies ({patientStudies.length})
                            </h3>
                            
                            {patientStudies.map((study) => (
                              <Card key={study.id} className="border-l-4 border-l-green-500 bg-green-50/30 hover:bg-green-50/50 transition-colors">
                                <CardContent className="p-4">
                                  <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-start gap-3">
                                        <Activity className="h-5 w-5 text-green-600 mt-1" />
                                        <div>
                                          <h4 className="font-semibold text-gray-900 text-lg">
                                            {study.studyDescription || "Unknown Study"}
                                          </h4>
                                          <div className="text-sm text-gray-600 mt-2 space-y-1">
                                            <div className="flex items-center gap-2">
                                              <Calendar className="h-4 w-4" />
                                              <span>Study Date: {formatDate(study.studyDate)}</span>
                                            </div>
                                            {study.accessionNumber && (
                                              <div>Accession: {study.accessionNumber}</div>
                                            )}
                                            <div>Study UID: {study.studyInstanceUID}</div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-3 ml-4">
                                      <div className="text-right space-y-2">
                                        <Badge className={`${
                                          study.modality === 'CT' ? 'bg-blue-100 text-blue-800 border-blue-300' :
                                          study.modality === 'MR' ? 'bg-green-100 text-green-800 border-green-300' :
                                          study.modality === 'RTSTRUCT' ? 'bg-purple-100 text-purple-800 border-purple-300' :
                                          study.modality === 'RTPLAN' ? 'bg-orange-100 text-orange-800 border-orange-300' :
                                          study.modality === 'RTDOSE' ? 'bg-red-100 text-red-800 border-red-300' :
                                          'bg-gray-100 text-gray-800 border-gray-300'
                                        } text-sm font-semibold px-3 py-1`}>
                                          {study.modality}
                                        </Badge>
                                        <div className="flex gap-2">
                                          <Badge variant="outline" className="text-xs">
                                            {study.numberOfSeries} series
                                          </Badge>
                                          <Badge variant="outline" className="text-xs">
                                            {study.numberOfImages} images
                                          </Badge>
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
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Import DICOM Tab */}
          <TabsContent value="import" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Import DICOM Files
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DICOMUploader />
              </CardContent>
            </Card>
          </TabsContent>

          {/* PACS Tab */}
          <TabsContent value="pacs" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>PACS Connections</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">PACS integration coming soon...</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Query Tab */}
          <TabsContent value="query" className="space-y-4">
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