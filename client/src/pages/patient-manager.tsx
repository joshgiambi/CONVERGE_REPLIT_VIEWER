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
import { PatientCard } from "@/components/patient-manager/patient-card";
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPacs, setSelectedPacs] = useState<number | null>(null);
  const [queryResults, setQueryResults] = useState<DICOMQueryResult[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [activeTab, setActiveTab] = useState("patients");
  const [hasActiveParsingSession, setHasActiveParsingSession] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check for active parsing session
  useEffect(() => {
    const checkActiveSession = async () => {
      const sessionId = localStorage.getItem('currentParseSessionId');
      if (!sessionId) {
        setHasActiveParsingSession(false);
        return;
      }

      // Check if session is actually still active
      try {
        const response = await fetch(`/api/parse-dicom-session/${sessionId}`);
        if (response.ok) {
          const session = await response.json();
          // Only show animation if session is actively parsing
          setHasActiveParsingSession(session.status === 'parsing');
        } else {
          setHasActiveParsingSession(false);
          localStorage.removeItem('currentParseSessionId');
        }
      } catch (error) {
        setHasActiveParsingSession(false);
      }
    };

    // Check immediately
    checkActiveSession();

    // Check periodically while on this page
    const interval = setInterval(checkActiveSession, 2000);

    return () => clearInterval(interval);
  }, []);

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
  
  // Fetch series data for patient cards
  const { data: series = [] } = useQuery<any[]>({
    queryKey: ["/api/series"],
  });

  // Fetch PACS connections
  const { data: pacsConnections = [], isLoading: pacsLoading } = useQuery<PacsConnection[]>({
    queryKey: ["/api/pacs"],
  });

  // Fetch all patient tags for filtering
  const { data: patientTags = [] } = useQuery<any[]>({
    queryKey: ["/api/patient-tags"],
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

  // Get unique tags from all patient tags
  const uniqueTags = [...new Set(patientTags.map(tag => tag.tagValue))];

  // Filter patients and studies
  const filteredPatients = patients.filter(patient => {
    // Search term filter
    const matchesSearch = patient.patientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         patient.patientID?.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Tag filter
    const patientTagValues = patientTags
      .filter(tag => tag.patientId === patient.id)
      .map(tag => tag.tagValue);
    
    const matchesTags = selectedTags.length === 0 || 
                       selectedTags.some(tag => patientTagValues.includes(tag));
    
    return matchesSearch && matchesTags;
  });

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
        <header className="fixed top-4 left-4 right-4 bg-gray-900/80 backdrop-blur-md border border-pink-500/50 rounded-2xl px-6 py-3 z-50 shadow-xl">
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
        <div className="mb-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
            <Input
              placeholder="Search patients, studies, or modalities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-12 bg-gray-900/80 border border-gray-700/50 text-white placeholder:text-gray-500 
                       focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 rounded-xl
                       transition-all duration-200"
            />
          </div>
          
          {/* Tag Filters */}
          {uniqueTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-sm text-gray-400 self-center mr-2">Filter by tags:</span>
              {uniqueTags.map(tag => (
                <Button
                  key={tag}
                  variant={selectedTags.includes(tag) ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    if (selectedTags.includes(tag)) {
                      setSelectedTags(selectedTags.filter(t => t !== tag));
                    } else {
                      setSelectedTags([...selectedTags, tag]);
                    }
                  }}
                  className={`text-xs transition-all ${
                    selectedTags.includes(tag)
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-500'
                      : 'bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 border-gray-600'
                  }`}
                >
                  {tag}
                </Button>
              ))}
              {selectedTags.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedTags([])}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 bg-gray-900/60 border border-gray-700/50 rounded-xl p-1">
            <TabsTrigger value="patients" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600/20 data-[state=active]:to-indigo-700/20 data-[state=active]:text-white text-gray-400 rounded-lg transition-all">
              <User className="h-4 w-4" />
              Patients
            </TabsTrigger>
            <TabsTrigger value="import" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600/20 data-[state=active]:to-indigo-700/20 data-[state=active]:text-white text-gray-400 rounded-lg transition-all relative">
              <Upload className="h-4 w-4" />
              Import DICOM
              {hasActiveParsingSession && (
                <div className="absolute -top-1 -right-1 h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
                </div>
              )}
            </TabsTrigger>
            <TabsTrigger value="pacs" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600/20 data-[state=active]:to-indigo-700/20 data-[state=active]:text-white text-gray-400 rounded-lg transition-all">
              <Network className="h-4 w-4" />
              PACS
            </TabsTrigger>
            <TabsTrigger value="query" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600/20 data-[state=active]:to-indigo-700/20 data-[state=active]:text-white text-gray-400 rounded-lg transition-all">
              <Database className="h-4 w-4" />
              Query
            </TabsTrigger>
            <TabsTrigger value="metadata" className="flex items-center gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-600/20 data-[state=active]:to-indigo-700/20 data-[state=active]:text-white text-gray-400 rounded-lg transition-all">
              <FileText className="h-4 w-4" />
              Metadata
            </TabsTrigger>
          </TabsList>

          {/* Patients Tab */}
          <TabsContent value="patients" className="space-y-4">
            {patientsLoading ? (
              <div className="text-center py-8">Loading patients...</div>
            ) : filteredPatients.length === 0 ? (
              <Card className="bg-gray-900/60 border-gray-700/50">
                <CardContent className="text-center py-12">
                  <User className="h-16 w-16 text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-400 text-lg">No patients found</p>
                  <p className="text-gray-500 text-sm mt-2">Upload DICOM files to get started</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredPatients.map((patient) => {
                  // Get studies and series for this patient
                  const patientStudies = studies.filter(study => study.patientId === patient.id);
                  const patientSeries = series.filter(s => 
                    patientStudies.some(study => study.id === s.studyId)
                  );
                  
                  return (
                    <PatientCard
                      key={patient.id}
                      patient={{
                        ...patient,
                        patientId: patient.patientID,
                        sex: patient.patientSex,
                        age: patient.patientAge
                      }}
                      studies={patientStudies}
                      series={patientSeries}
                      onUpdate={() => {
                        queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/series"] });
                      }}
                    />
                  );
                })}
              </div>
            )}
          </TabsContent>



          {/* Import DICOM Tab */}
          <TabsContent value="import" className="space-y-4">
            <Card className="bg-gray-900/80 border border-gray-700/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Upload className="h-5 w-5 text-purple-400" />
                  Import DICOM Files
                </CardTitle>
                <CardDescription className="text-gray-400">
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
          {/* Metadata Tab */}
          <TabsContent value="metadata" className="space-y-4">
            <MetadataViewer />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// Metadata Viewer Component
function MetadataViewer() {
  const [isLoading, setIsLoading] = useState(false);
  const [metadata, setMetadata] = useState<any>(null);
  const [expandedSeries, setExpandedSeries] = useState<Set<number>>(new Set());

  useEffect(() => {
    const fetchMetadata = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/metadata/all');
        if (response.ok) {
          const data = await response.json();
          setMetadata(data);
        }
      } catch (error) {
        console.error('Error fetching metadata:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchMetadata();
  }, []);

  const toggleSeries = (seriesId: number) => {
    setExpandedSeries(prev => {
      const next = new Set(prev);
      if (next.has(seriesId)) {
        next.delete(seriesId);
      } else {
        next.add(seriesId);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <Card className="bg-gray-900/60 border-gray-700/50">
        <CardContent className="py-8 text-center">
          <p className="text-gray-400">Loading metadata...</p>
        </CardContent>
      </Card>
    );
  }

  if (!metadata) {
    return (
      <Card className="bg-gray-900/60 border-gray-700/50">
        <CardContent className="py-8 text-center">
          <p className="text-gray-400">No metadata available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <Card className="bg-gray-900/60 border-gray-700/50">
        <CardHeader>
          <CardTitle className="text-white">DICOM Database Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/30">
              <p className="text-gray-400 text-sm">Total Patients</p>
              <p className="text-2xl font-bold text-white">{metadata.summary.totalPatients}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/30">
              <p className="text-gray-400 text-sm">Total Studies</p>
              <p className="text-2xl font-bold text-white">{metadata.summary.totalStudies}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/30">
              <p className="text-gray-400 text-sm">Total Series</p>
              <p className="text-2xl font-bold text-white">{metadata.summary.totalSeries}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700/30">
              <p className="text-gray-400 text-sm">Total Images</p>
              <p className="text-2xl font-bold text-white">{metadata.summary.totalImages}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Metadata */}
      <Card className="bg-gray-900/60 border-gray-700/50">
        <CardHeader>
          <CardTitle className="text-white">Detailed DICOM Metadata</CardTitle>
          <CardDescription className="text-gray-400">
            Click on series to expand and view image metadata
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {metadata.patients.map((patient: any) => {
              const patientStudies = metadata.studies.filter((s: any) => s.patientId === patient.id);
              const patientSeries = metadata.series.filter((s: any) => 
                patientStudies.some((study: any) => study.id === s.studyId)
              );
              
              return (
                <div key={patient.id} className="border border-gray-700/50 rounded-lg p-4 bg-gray-800/30">
                  <h3 className="text-white font-semibold mb-2">
                    {patient.patientName} (ID: {patient.patientID})
                  </h3>
                  
                  {patientSeries.map((series: any) => (
                    <div key={series.id} className="ml-4 mb-2">
                      <button
                        onClick={() => toggleSeries(series.id)}
                        className="w-full text-left p-2 rounded hover:bg-gray-700/30 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <Badge className="mr-2" variant="outline">
                              {series.modality}
                            </Badge>
                            <span className="text-gray-300">
                              {series.seriesDescription || 'Series ' + series.seriesNumber}
                            </span>
                            <span className="text-gray-500 ml-2">
                              ({series.imageCount || series.images?.length || 0} images)
                            </span>
                          </div>
                          <span className="text-gray-500">
                            {expandedSeries.has(series.id) ? '▼' : '▶'}
                          </span>
                        </div>
                      </button>
                      
                      {expandedSeries.has(series.id) && series.images && (
                        <div className="ml-8 mt-2 space-y-1 text-sm">
                          <div className="grid grid-cols-2 gap-2 text-gray-400">
                            <div>Series UID: {series.seriesInstanceUID}</div>
                            <div>Slice Thickness: {series.sliceThickness || 'N/A'}</div>
                          </div>
                          {series.metadata && (
                            <div className="mt-2 p-2 bg-gray-900/50 rounded">
                              <pre className="text-xs text-gray-500 overflow-x-auto">
                                {JSON.stringify(series.metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                          {series.images.slice(0, 3).map((image: any, idx: number) => (
                            <div key={image.id} className="p-2 bg-gray-900/50 rounded">
                              <div className="text-gray-300">
                                Instance #{image.instanceNumber}
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                                <div>Slice Location: {image.sliceLocation || 'N/A'}</div>
                                <div>Window: {image.windowCenter}/{image.windowWidth}</div>
                                <div>Position: {image.imagePosition || 'N/A'}</div>
                                <div>Orientation: {image.imageOrientation || 'N/A'}</div>
                              </div>
                            </div>
                          ))}
                          {series.images.length > 3 && (
                            <p className="text-gray-500 text-xs">
                              ... and {series.images.length - 3} more images
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}