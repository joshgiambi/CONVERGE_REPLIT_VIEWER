import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DICOMUploader } from "@/components/dicom/dicom-uploader";
import { 
  User, 
  Calendar, 
  FileText, 
  Network, 
  Settings, 
  Search, 
  Download, 
  Upload, 
  Database,
  Activity,
  Wifi,
  WifiOff,
  Play,
  Eye
} from "lucide-react";

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

const pacsConnectionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  aeTitle: z.string().min(1, "AE Title is required"),
  hostname: z.string().min(1, "Hostname is required"),
  port: z.number().min(1).max(65535, "Port must be between 1 and 65535"),
  callingAeTitle: z.string().default("DICOM_VIEWER"),
  protocol: z.enum(["DICOM", "DICOMweb"]).default("DICOM"),
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

  // PACS connection form
  const pacsForm = useForm<z.infer<typeof pacsConnectionSchema>>({
    resolver: zodResolver(pacsConnectionSchema),
    defaultValues: {
      name: "",
      aeTitle: "",
      hostname: "",
      port: 104,
      callingAeTitle: "DICOM_VIEWER",
      protocol: "DICOM",
    },
  });

  // Query form
  const queryForm = useForm<z.infer<typeof querySchema>>({
    resolver: zodResolver(querySchema),
    defaultValues: {
      patientName: "",
      patientID: "",
      studyDate: "",
      studyDescription: "",
      accessionNumber: "",
      modality: "",
    },
  });

  // Create PACS connection mutation
  const createPacsMutation = useMutation({
    mutationFn: async (data: z.infer<typeof pacsConnectionSchema>) => {
      const response = await fetch("/api/pacs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create PACS connection");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pacs"] });
      pacsForm.reset();
      toast({ title: "PACS connection created successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create PACS connection",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Test PACS connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async (pacsId: number) => {
      const response = await fetch(`/api/pacs/${pacsId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Failed to test connection");
      return response.json();
    },
    onSuccess: (data: { connected: boolean }, pacsId: number) => {
      const connection = pacsConnections.find(p => p.id === pacsId);
      toast({
        title: data.connected ? "Connection successful" : "Connection failed",
        description: data.connected 
          ? `Successfully connected to ${connection?.name}` 
          : `Failed to connect to ${connection?.name}`,
        variant: data.connected ? "default" : "destructive",
      });
    },
  });

  // Query PACS mutation
  const queryPacsMutation = useMutation({
    mutationFn: async ({ pacsId, queryParams }: { pacsId: number; queryParams: z.infer<typeof querySchema> }) => {
      const response = await fetch(`/api/pacs/${pacsId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queryParams),
      });
      if (!response.ok) throw new Error("Failed to query PACS");
      return response.json();
    },
    onSuccess: (data: DICOMQueryResult[]) => {
      setQueryResults(data);
      toast({
        title: "Query completed",
        description: `Found ${data.length} studies`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Query failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Filter patients and studies
  const filteredPatients = patients.filter(patient =>
    patient.patientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.patientID?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredStudies = studies.filter(study =>
    study.patientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    study.studyDescription?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    study.modality?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreatePacs = (data: z.infer<typeof pacsConnectionSchema>) => {
    createPacsMutation.mutate(data);
  };

  const handleTestConnection = (pacsId: number) => {
    testConnectionMutation.mutate(pacsId);
  };

  const handleQueryPacs = (data: z.infer<typeof querySchema>) => {
    if (!selectedPacs) {
      toast({
        title: "No PACS selected",
        description: "Please select a PACS connection first",
        variant: "destructive",
      });
      return;
    }
    
    setIsQuerying(true);
    queryPacsMutation.mutate(
      { pacsId: selectedPacs, queryParams: data },
      {
        onSettled: () => setIsQuerying(false),
      }
    );
  };

  const handleFileUpload = async (files: File[]) => {
    try {
      const formData = new FormData();
      files.forEach((file, index) => {
        formData.append('files', file);
      });

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      
      toast({
        title: "Upload successful",
        description: `Uploaded ${result.processed} files successfully`,
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      
    } catch (error) {
      toast({
        title: "Upload failed",
        description: "Failed to upload DICOM files",
        variant: "destructive",
      });
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "Unknown";
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto px-4 pt-24 pb-8">
        {/* Header matching viewer interface */}
        <header className="fixed top-4 left-4 right-4 bg-gray-900/80 backdrop-blur-md border border-gray-700/30 rounded-2xl px-6 py-3 z-50 shadow-xl">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-4">
              <div>
                <h1 className="text-xl font-black tracking-widest" style={{ letterSpacing: '0.25em' }}>
                  <span style={{
                    color: 'white',
                    fontWeight: '900'
                  }}>S</span>
                  <span style={{
                    color: 'white',
                    fontWeight: '900'
                  }}>U</span>
                  <span style={{
                    color: 'white',
                    fontWeight: '900'
                  }}>P</span>
                  <span style={{
                    color: 'white',
                    fontWeight: '900'
                  }}>E</span>
                  <span style={{
                    color: 'white',
                    fontWeight: '900'
                  }}>R</span>
                  <span style={{
                    background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    fontWeight: '900'
                  }}>B</span>
                  <span style={{
                    background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    fontWeight: '900'
                  }}>E</span>
                  <span style={{
                    background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    fontWeight: '900'
                  }}>A</span>
                  <span style={{
                    background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    fontWeight: '900'
                  }}>M</span>
                </h1>
              </div>
            </div>
          </div>
        </header>

        {/* Search Bar with dark styling */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              placeholder="Search patients, studies, or modalities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-gray-900/60 border-gray-700/50 text-white placeholder:text-gray-400 focus:border-gray-600"
            />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-gray-900/60 border-gray-700/50">
            <TabsTrigger value="patients" className="flex items-center gap-2 data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-300">
              <User className="h-4 w-4" />
              Patients
            </TabsTrigger>
            <TabsTrigger value="import" className="flex items-center gap-2 data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-300">
              <Upload className="h-4 w-4" />
              Import DICOM
            </TabsTrigger>
            <TabsTrigger value="pacs" className="flex items-center gap-2 data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-300">
              <Network className="h-4 w-4" />
              PACS
            </TabsTrigger>
            <TabsTrigger value="query" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Query
            </TabsTrigger>
          </TabsList>

          {/* Patients Tab */}
          <TabsContent value="patients" className="space-y-4">
            {patientsLoading ? (
              <div className="text-center py-8">Loading patients...</div>
            ) : filteredPatients.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8">
                  <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No patients found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredPatients.map((patient) => (
                  <Card key={patient.id} className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <User className="h-5 w-5" />
                        {patient.patientName || "Unknown Patient"}
                      </CardTitle>
                      <CardDescription>
                        ID: {patient.patientID}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        {patient.patientSex && (
                          <div>Sex: {patient.patientSex}</div>
                        )}
                        {patient.patientAge && (
                          <div>Age: {patient.patientAge}</div>
                        )}
                        {patient.dateOfBirth && (
                          <div>DOB: {formatDate(patient.dateOfBirth)}</div>
                        )}
                        <div className="text-gray-500">
                          Created: {formatDate(patient.createdAt)}
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            // Filter studies for this patient and prioritize CT studies
                            const patientStudies = studies.filter(study => study.patientID === patient.patientID);
                            if (patientStudies.length > 0) {
                              // Prioritize CT studies over RT structure sets
                              const ctStudy = patientStudies.find(study => study.modality === 'CT');
                              const targetStudy = ctStudy || patientStudies[0];
                              window.location.href = `/dicom-viewer?studyId=${targetStudy.id}`;
                            } else {
                              toast({
                                title: "No studies found",
                                description: `No studies found for patient ${patient.patientName}`,
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Viewer
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          className="flex-1 bg-green-600 hover:bg-green-700"
                          onClick={() => {
                            // Filter studies for this patient and prioritize CT studies
                            const patientStudies = studies.filter(study => study.patientID === patient.patientID);
                            if (patientStudies.length > 0) {
                              // Prioritize CT studies over RT structure sets
                              const ctStudy = patientStudies.find(study => study.modality === 'CT');
                              const targetStudy = ctStudy || patientStudies[0];
                              window.location.href = `/enhanced-viewer?studyId=${targetStudy.id}`;
                            } else {
                              toast({
                                title: "No studies found",
                                description: `No studies found for patient ${patient.patientName}`,
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          <Activity className="h-4 w-4 mr-1" />
                          Enhanced
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
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
                <CardDescription>
                  Upload DICOM files to parse metadata and import into the database. 
                  Supports CT, MRI, PET/CT, RT Structure Sets, Dose, and Plan files.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DICOMUploader />
              </CardContent>
            </Card>
          </TabsContent>

          {/* PACS Tab */}
          <TabsContent value="pacs" className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">PACS Connections</h3>
              <Dialog>
                <DialogTrigger asChild>
                  <Button>
                    <Network className="h-4 w-4 mr-2" />
                    Add PACS
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Add PACS Connection</DialogTitle>
                    <DialogDescription>
                      Configure a new PACS connection for DICOM networking.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...pacsForm}>
                    <form onSubmit={pacsForm.handleSubmit(handleCreatePacs)} className="space-y-4">
                      <FormField
                        control={pacsForm.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                              <Input placeholder="Hospital PACS" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={pacsForm.control}
                        name="aeTitle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>AE Title</FormLabel>
                            <FormControl>
                              <Input placeholder="PACS_SERVER" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={pacsForm.control}
                        name="hostname"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Hostname</FormLabel>
                            <FormControl>
                              <Input placeholder="pacs.hospital.com" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={pacsForm.control}
                        name="port"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Port</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                placeholder="104" 
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value) || 104)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={pacsForm.control}
                        name="protocol"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Protocol</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select protocol" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="DICOM">DICOM (DIMSE)</SelectItem>
                                <SelectItem value="DICOMweb">DICOMweb (WADO/QIDO/STOW)</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        className="w-full" 
                        disabled={createPacsMutation.isPending}
                      >
                        {createPacsMutation.isPending ? "Creating..." : "Create Connection"}
                      </Button>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>

            {pacsLoading ? (
              <div className="text-center py-8">Loading PACS connections...</div>
            ) : pacsConnections.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8">
                  <Network className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No PACS connections configured</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {pacsConnections.map((connection) => (
                  <Card key={connection.id} className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {connection.isActive ? (
                            <Wifi className="h-5 w-5 text-green-500" />
                          ) : (
                            <WifiOff className="h-5 w-5 text-red-500" />
                          )}
                          {connection.name}
                        </div>
                        <Badge variant="outline">{connection.protocol}</Badge>
                      </CardTitle>
                      <CardDescription>
                        {connection.aeTitle} @ {connection.hostname}:{connection.port}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTestConnection(connection.id)}
                          disabled={testConnectionMutation.isPending}
                        >
                          <Activity className="h-4 w-4 mr-2" />
                          Test
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedPacs(connection.id)}
                          disabled={selectedPacs === connection.id}
                        >
                          {selectedPacs === connection.id ? "Selected" : "Select"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Query Tab */}
          <TabsContent value="query" className="space-y-4">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>DICOM Query</CardTitle>
                  <CardDescription>
                    Query PACS for studies using C-FIND or QIDO-RS
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!selectedPacs ? (
                    <div className="text-center py-8">
                      <Database className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">Select a PACS connection first</p>
                    </div>
                  ) : (
                    <Form {...queryForm}>
                      <form onSubmit={queryForm.handleSubmit(handleQueryPacs)} className="space-y-4">
                        <FormField
                          control={queryForm.control}
                          name="patientName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Patient Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Smith^John" {...field} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={queryForm.control}
                          name="patientID"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Patient ID</FormLabel>
                              <FormControl>
                                <Input placeholder="12345" {...field} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={queryForm.control}
                          name="studyDate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Study Date</FormLabel>
                              <FormControl>
                                <Input placeholder="20240101" {...field} />
                              </FormControl>
                              <FormDescription>
                                Format: YYYYMMDD or date range YYYYMMDD-YYYYMMDD
                              </FormDescription>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={queryForm.control}
                          name="modality"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Modality</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="All modalities" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="">All modalities</SelectItem>
                                  <SelectItem value="CT">CT</SelectItem>
                                  <SelectItem value="MR">MR</SelectItem>
                                  <SelectItem value="PT">PT</SelectItem>
                                  <SelectItem value="CR">CR</SelectItem>
                                  <SelectItem value="DX">DX</SelectItem>
                                  <SelectItem value="US">US</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <Button 
                          type="submit" 
                          className="w-full" 
                          disabled={isQuerying}
                        >
                          <Search className="h-4 w-4 mr-2" />
                          {isQuerying ? "Querying..." : "Query PACS"}
                        </Button>
                      </form>
                    </Form>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Query Results</CardTitle>
                  <CardDescription>
                    Studies found on PACS ({queryResults.length} results)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {queryResults.length === 0 ? (
                    <div className="text-center py-8">
                      <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No query results yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {queryResults.map((result, index) => (
                        <Card key={index} className="p-3">
                          <div className="space-y-1 text-sm">
                            <div className="font-medium">
                              {result.patientName || "Unknown Patient"}
                            </div>
                            <div className="text-gray-500">
                              ID: {result.patientID} | {result.modality}
                            </div>
                            <div className="text-gray-500">
                              {result.studyDescription}
                            </div>
                            <div className="text-gray-500">
                              Date: {result.studyDate} | Series: {result.numberOfStudyRelatedSeries} | Images: {result.numberOfStudyRelatedInstances}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full mt-2"
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Retrieve Study
                          </Button>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}