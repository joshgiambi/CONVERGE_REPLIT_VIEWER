import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DICOMUploader } from "@/components/dicom/dicom-uploader";
import { PatientCard } from "@/components/patient-manager/patient-card";
import { useParsingSession } from "@/hooks/use-parsing-session";
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
  Eye,
  AlertTriangle,
  FolderDown,
  Merge,
  CheckSquare,
  Trash2,
  Star,
  Clock,
  Import,
  X
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

type FusionAssociationStatus = 'ready' | 'pending' | 'missing-secondary' | 'unmapped';

interface SeriesSummary {
  id: number;
  studyId: number;
  seriesInstanceUID: string;
  seriesDescription: string | null;
  modality: string | null;
  seriesNumber: number | null;
  imageCount: number | null;
  sliceThickness?: string | null;
  createdAt: string | null;
}

interface DerivedFusionDetails {
  primarySeriesId: number | null;
  secondarySeriesId: number | null;
  registrationId: string | null;
  transformSource: string | null;
  interpolation: string | null;
  generatedAt: string | null;
  manifestPath: string | null;
  outputDirectory: string | null;
  markers: string[];
}

type DerivedSeriesSummary = SeriesSummary & { fusion: DerivedFusionDetails };

type RegistrationSeriesSummary = SeriesSummary & {
  filePath: string | null;
  fileExists: boolean;
  referencedSeriesInstanceUIDs: string[];
  referencedSeriesIds: number[];
  parsed: {
    matrixRowMajor4x4: number[] | null;
    sourceFrameOfReferenceUid: string | null;
    targetFrameOfReferenceUid: string | null;
    notes: string[];
  } | null;
};

type FusionAssociationSummary = {
  studyId: number | null;
  registrationSeriesId: number | null;
  registrationFilePath: string | null;
  registrationId: string | null;
  primarySeriesId: number | null;
  secondarySeriesId: number | null;
  derivedSeriesId: number | null;
  status: FusionAssociationStatus;
  reason?: string;
  markers: string[];
  transformSource?: string | null;
  registrationSeries: RegistrationSeriesSummary | null;
  primarySeries: SeriesSummary | null;
  secondarySeries: SeriesSummary | null;
  derivedSeries: DerivedSeriesSummary | null;
};

type PatientFusionOverviewDebug = {
  generatedAt: string;
  fusedDirectories: Array<{ studyId: number; path: string; exists: boolean; contents: string[] }>;
  missingPaths: Array<{ seriesId: number; path: string }>;
};

interface PatientFusionOverview {
  patient: {
    id: number;
    patientID: string | null;
    patientName: string | null;
    createdAt: string | null;
  };
  summary: {
    totalStudies: number;
    totalSeries: number;
    registrationSeries: number;
    derivedSeries: number;
  };
  studies: Array<{
    id: number;
    studyInstanceUID: string;
    studyDescription: string | null;
    studyDate: string | null;
    accessionNumber: string | null;
    modalityCounts: Record<string, number>;
    series: SeriesSummary[];
    registrationSeries: RegistrationSeriesSummary[];
    derivedSeries: DerivedSeriesSummary[];
    associations: FusionAssociationSummary[];
  }>;
  registrationSeries: RegistrationSeriesSummary[];
  derivedSeries: DerivedSeriesSummary[];
  associations: FusionAssociationSummary[];
  debug?: PatientFusionOverviewDebug;
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
  const [fusionPatientId, setFusionPatientId] = useState<number | null>(null);
  
  // New state for favorites and recent patients
  const [favoritePatients, setFavoritePatients] = useState<Set<number>>(new Set());
  const [recentlyOpenedPatients, setRecentlyOpenedPatients] = useState<number[]>([]);
  const [recentlyImportedPatients, setRecentlyImportedPatients] = useState<Array<{patientId: string | number; importDate: number}>>([]);
  const [hasPendingData, setHasPendingData] = useState(false);
  const [selectedPatients, setSelectedPatients] = useState<Set<number>>(new Set());
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [exportItems, setExportItems] = useState<any[]>([]);
  const [selectedExportItems, setSelectedExportItems] = useState<Set<string>>(new Set());
  const hasActiveParsingSession = useParsingSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Toggle favorite status for a patient
  const toggleFavorite = (patientId: number) => {
    setFavoritePatients(prev => {
      const newSet = new Set(prev);
      if (newSet.has(patientId)) {
        newSet.delete(patientId);
      } else {
        newSet.add(patientId);
      }
      // Save to localStorage
      localStorage.setItem('favoritePatients', JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  };

  // Track when a patient is opened
  const trackPatientOpened = (patientId: number) => {
    setRecentlyOpenedPatients(prev => {
      const newList = [patientId, ...prev.filter(id => id !== patientId)].slice(0, 10);
      localStorage.setItem('recentlyOpenedPatients', JSON.stringify(newList));
      return newList;
    });
  };

  // Track when a patient is imported
  const trackPatientImported = (patientId: number | string, importDate?: number) => {
    const timestamp = importDate || Date.now();
    setRecentlyImportedPatients(prev => {
      const newEntry = { patientId, importDate: timestamp };
      const newList = [newEntry, ...prev.filter(item => item.patientId !== patientId)].slice(0, 10);
      localStorage.setItem('recentlyImportedPatients', JSON.stringify(newList));
      return newList;
    });
  };

  // Load saved data from localStorage on mount and listen for updates
  useEffect(() => {
    const loadStoredData = () => {
      const savedFavorites = localStorage.getItem('favoritePatients');
      if (savedFavorites) {
        setFavoritePatients(new Set(JSON.parse(savedFavorites)));
      }

      const savedRecentlyOpened = localStorage.getItem('recentlyOpenedPatients');
      if (savedRecentlyOpened) {
        setRecentlyOpenedPatients(JSON.parse(savedRecentlyOpened));
      }

      const savedRecentlyImported = localStorage.getItem('recentlyImportedPatients');
      if (savedRecentlyImported) {
        const parsed = JSON.parse(savedRecentlyImported);
        // Handle both old format (array of IDs) and new format (array of objects)
        if (parsed.length > 0 && typeof parsed[0] === 'object' && 'patientId' in parsed[0]) {
          setRecentlyImportedPatients(parsed);
        } else {
          // Convert old format to new format
          const converted = parsed.map((id: number) => ({ patientId: id, importDate: Date.now() }));
          setRecentlyImportedPatients(converted);
          localStorage.setItem('recentlyImportedPatients', JSON.stringify(converted));
        }
      }
    };
    
    loadStoredData();
    
    // Listen for recently imported updates from other components
    const handleRecentlyImportedUpdate = () => {
      const savedRecentlyImported = localStorage.getItem('recentlyImportedPatients');
      if (savedRecentlyImported) {
        setRecentlyImportedPatients(JSON.parse(savedRecentlyImported));
      }
    };
    
    window.addEventListener('recentlyImportedUpdated', handleRecentlyImportedUpdate);
    
    return () => {
      window.removeEventListener('recentlyImportedUpdated', handleRecentlyImportedUpdate);
    };
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

  // Check for unprocessed files periodically
  useEffect(() => {
    const checkUnprocessedFiles = async () => {
      try {
        const response = await fetch('/api/unprocessed-files');
        if (response.ok) {
          const data = await response.json();
          setHasPendingData(data.files && data.files.length > 0);
        }
      } catch (error) {
        console.error('Error checking unprocessed files:', error);
      }
    };

    // Check immediately and then every 5 seconds
    checkUnprocessedFiles();
    const interval = setInterval(checkUnprocessedFiles, 5000);

    return () => clearInterval(interval);
  }, []);

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

  useEffect(() => {
    if (fusionPatientId == null && patients.length) {
      setFusionPatientId(patients[0].id);
    }
  }, [fusionPatientId, patients]);

  const fusionOverviewQuery = useQuery<PatientFusionOverview>({
    queryKey: fusionPatientId ? ["/api/patients", fusionPatientId, "fusion", "overview"] : ["/api/patients", "fusion", "overview", "idle"],
    queryFn: async () => {
      if (fusionPatientId == null) throw new Error('No patient selected');
      const response = await fetch(`/api/patients/${fusionPatientId}/fusion/overview`);
      if (!response.ok) {
        throw new Error(`Failed to load fusion overview (${response.status})`);
      }
      return (await response.json()) as PatientFusionOverview;
    },
    enabled: fusionPatientId != null,
  });

  const fusionOverview = fusionOverviewQuery.data;
  const fusionOverviewLoading = fusionOverviewQuery.isLoading;
  const fusionOverviewFetching = fusionOverviewQuery.isFetching;
  const fusionStatusStyles: Record<FusionAssociationStatus, { label: string; className: string }> = {
    ready: { label: 'Ready', className: 'bg-emerald-500/10 border-emerald-400/40 text-emerald-200 border' },
    pending: { label: 'Pending', className: 'bg-amber-500/10 border-amber-400/40 text-amber-200 border' },
    'missing-secondary': { label: 'Needs Match', className: 'bg-rose-500/10 border-rose-400/40 text-rose-200 border' },
    unmapped: { label: 'Unmapped', className: 'bg-slate-500/10 border-slate-400/40 text-slate-200 border' },
  };

  const runManifestMutation = useMutation({
    mutationFn: async () => {
      if (fusionPatientId == null) {
        throw new Error('Select a patient first');
      }
      const response = await fetch(`/api/patients/${fusionPatientId}/fusion/run-manifest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeReady: false }),
      });
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(message || `Manifest run failed (${response.status})`);
      }
      return (await response.json()) as { ok: boolean; overview: PatientFusionOverview; runs: any[] };
    },
    onSuccess: (data) => {
      toast({
        title: 'Manifest run requested',
        description: `${data?.runs?.length ?? 0} fusion pair${(data?.runs?.length ?? 0) === 1 ? '' : 's'} queued.`,
      });
      fusionOverviewQuery.refetch();
    },
    onError: (error: any) => {
      toast({
        title: 'Manifest run failed',
        description: error?.message || 'Unable to trigger manifest run.',
        variant: 'destructive',
      });
    },
  });

  const clearFusionMutation = useMutation({
    mutationFn: async () => {
      if (fusionPatientId == null) {
        throw new Error('Select a patient first');
      }
      const response = await fetch(`/api/patients/${fusionPatientId}/fusion/clear`, {
        method: 'POST',
      });
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(message || `Failed to clear derived data (${response.status})`);
      }
      return (await response.json()) as { ok: boolean; overview: PatientFusionOverview };
    },
    onSuccess: () => {
      toast({
        title: 'Derived series cleared',
        description: 'Fused series removed and manifest cache reset.',
      });
      fusionOverviewQuery.refetch();
    },
    onError: (error: any) => {
      toast({
        title: 'Clear failed',
        description: error?.message || 'Unable to clear derived data.',
        variant: 'destructive',
      });
    },
  });

  const handleFusionDebugFetch = useCallback(async () => {
    if (fusionPatientId == null) {
      toast({ title: 'Select a patient', description: 'Choose a patient to inspect fusion data.', variant: 'destructive' });
      return;
    }
    try {
      const response = await fetch(`/api/patients/${fusionPatientId}/fusion/overview?debug=true`, { cache: 'no-store' });
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(message || `Debug fetch failed (${response.status})`);
      }
      const payload = await response.json();
      console.groupCollapsed(`Fusion debug for patient ${fusionPatientId}`);
      console.debug(payload);
      console.groupEnd();
      toast({ title: 'Debug data ready', description: 'Inspect console for detailed fusion debug output.' });
    } catch (error: any) {
      toast({
        title: 'Debug fetch failed',
        description: error?.message || 'Unable to load fusion debug data.',
        variant: 'destructive',
      });
    }
  }, [fusionPatientId, toast]);

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

  // Export handler
  const handleExport = async () => {
    if (selectedPatients.size === 0) return;
    
    try {
      // Collect all series for selected patients
      const items = [];
      for (const patientId of selectedPatients) {
        const patient = patients.find(p => p.id === patientId);
        const patientStudies = studies.filter(s => s.patientId === patientId);
        
        for (const study of patientStudies) {
          const studySeries = series.filter(s => s.studyId === study.id);
          for (const s of studySeries) {
            items.push({
              id: `series-${s.id}`,
              type: 'series',
              name: `${patient?.patientName} - ${s.modality} - ${s.seriesDescription || 'Unnamed Series'}`,
              description: `${s.imageCount || 0} images`,
              data: s
            });
          }
        }
      }
      
      setExportItems(items);
      setSelectedExportItems(new Set());
      setShowExportDialog(true);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load export items",
        variant: "destructive"
      });
    }
  };

  const handleExportConfirm = async () => {
    if (selectedExportItems.size === 0) {
      toast({
        title: "Warning",
        description: "Please select items to export",
        variant: "destructive"
      });
      return;
    }
    
    try {
      // TODO: Implement export API endpoint
      toast({
        title: "Success",
        description: `Exporting ${selectedExportItems.size} items...`,
      });
      setShowExportDialog(false);
      setSelectedPatients(new Set());
    } catch (error) {
      toast({
        title: "Error", 
        description: "Failed to export files",
        variant: "destructive"
      });
    }
  };

  // Merge handler
  const handleMerge = () => {
    if (selectedPatients.size < 2) return;
    setShowMergeDialog(true);
  };

  const handleMergeConfirm = async (targetPatientId: number | 'new', newPatientName?: string) => {
    try {
      // TODO: Implement merge API endpoint
      toast({
        title: "Success",
        description: (targetPatientId as any) === 'new' 
          ? `Merging patients into new patient: ${newPatientName}`
          : `Merging patients into existing patient`,
      });
      setShowMergeDialog(false);
      setSelectedPatients(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to merge patients",
        variant: "destructive"
      });
    }
  };

  // Delete selected patients handler
  const handleDeleteSelected = async () => {
    if (selectedPatients.size === 0) return;
    
    if (!confirm(`Are you sure you want to delete ${selectedPatients.size} patient${selectedPatients.size !== 1 ? 's' : ''}? This action cannot be undone.`)) {
      return;
    }
    
    const patientIds = Array.from(selectedPatients);
    let successCount = 0;
    let errorCount = 0;
    
    for (const patientId of patientIds) {
      try {
        const response = await fetch(`/api/patients/${patientId}?full=true`, {
          method: "DELETE",
        });
        
        if (response.ok) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch (error) {
        errorCount++;
      }
    }
    
    if (successCount > 0) {
      toast({
        title: "Success",
        description: `Deleted ${successCount} patient${successCount !== 1 ? 's' : ''}`,
      });
      setSelectedPatients(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });
    }
    
    if (errorCount > 0) {
      toast({
        title: "Error",
        description: `Failed to delete ${errorCount} patient${errorCount !== 1 ? 's' : ''}`,
        variant: "destructive",
      });
    }
  };

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
    <div className="h-screen bg-black text-white flex flex-col overflow-hidden">
      {/* Header matching viewer interface */}
      <header className="fixed top-4 left-4 right-4 bg-gray-950/90 backdrop-blur-xl border border-gray-600/60 rounded-2xl px-6 py-3 z-50 shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-6">
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

      {/* Main layout with content and sidebar */}
      <div className="flex flex-1 pt-20 overflow-hidden">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Unified Control Panel with proper height management */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex-shrink-0">
              {/* Combined Container for Tabs, Search, and Tags */}
              <div className="bg-gray-950/90 backdrop-blur-xl border border-gray-600/70 rounded-2xl shadow-2xl shadow-black/40 p-3 mb-4">
                {/* Tabs Row */}
                <TabsList className="grid w-full grid-cols-6 bg-black/40 rounded-xl p-1 mb-4">
                  <TabsTrigger value="patients" className="flex items-center justify-center gap-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500/20 data-[state=active]:to-purple-500/20 data-[state=active]:backdrop-blur-xl data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:border data-[state=active]:border-white/10 text-gray-400 hover:text-gray-200 rounded-lg transition-all duration-200 py-2 px-3 hover:bg-white/5 text-sm font-medium">
                    <User className="h-4 w-4" />
                    Patients
                  </TabsTrigger>
                  <TabsTrigger value="import" className="flex items-center justify-center gap-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500/20 data-[state=active]:to-purple-500/20 data-[state=active]:backdrop-blur-xl data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:border data-[state=active]:border-white/10 text-gray-400 hover:text-gray-200 rounded-lg transition-all duration-200 py-2 px-3 hover:bg-white/5 text-sm font-medium">
                    <Upload className="h-4 w-4" />
                    <span>Import</span>
                    {hasActiveParsingSession ? (
                      <svg className="h-3.5 w-3.5 animate-spin text-green-400" viewBox="0 0 24 24" fill="none">
                        <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor"/>
                      </svg>
                    ) : hasPendingData ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="pacs" className="flex items-center justify-center gap-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500/20 data-[state=active]:to-purple-500/20 data-[state=active]:backdrop-blur-xl data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:border data-[state=active]:border-white/10 text-gray-400 hover:text-gray-200 rounded-lg transition-all duration-200 py-2 px-3 hover:bg-white/5 text-sm font-medium">
                    <Network className="h-4 w-4" />
                    PACS
                  </TabsTrigger>
                  <TabsTrigger value="query" className="flex items-center justify-center gap-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500/20 data-[state=active]:to-purple-500/20 data-[state=active]:backdrop-blur-xl data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:border data-[state=active]:border-white/10 text-gray-400 hover:text-gray-200 rounded-lg transition-all duration-200 py-2 px-3 hover:bg-white/5 text-sm font-medium">
                    <Database className="h-4 w-4" />
                    Query
                  </TabsTrigger>
                  <TabsTrigger value="fusion" className="flex items-center justify-center gap-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500/20 data-[state=active]:to-purple-500/20 data-[state=active]:backdrop-blur-xl data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:border data-[state=active]:border-white/10 text-gray-400 hover:text-gray-200 rounded-lg transition-all duration-200 py-2 px-3 hover:bg-white/5 text-sm font-medium">
                    <Merge className="h-4 w-4" />
                    Fusion
                  </TabsTrigger>
                  <TabsTrigger value="metadata" className="flex items-center justify-center gap-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500/20 data-[state=active]:to-purple-500/20 data-[state=active]:backdrop-blur-xl data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:border data-[state=active]:border-white/10 text-gray-400 hover:text-gray-200 rounded-lg transition-all duration-200 py-2 px-3 hover:bg-white/5 text-sm font-medium">
                    <FileText className="h-4 w-4" />
                    Metadata
                  </TabsTrigger>
                </TabsList>
                
                {/* Search Bar - Full Width */}
                <div className="relative w-full mb-3">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input
                    placeholder="Search patients, studies, or modalities..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-9 w-full bg-black/30 border border-gray-700/50 text-white placeholder:text-gray-500 
                             focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 rounded-lg
                             transition-all duration-200 text-sm"
                  />
                </div>
                
                {/* Tag Filters - Under Search */}
                {uniqueTags.length > 0 && (
                  <div className="flex gap-1.5 items-center flex-wrap">
                    {uniqueTags.map(tag => {
                      // Define tag colors based on tag type - matching patient card colors
                      const getTagStyle = (tagName: string) => {
                        const lower = tagName.toLowerCase();
                        if (lower.includes('head') || lower.includes('brain')) {
                          return {
                            base: 'bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20',
                            selected: 'bg-purple-600/30 border-purple-500 text-purple-100 shadow-lg shadow-purple-500/20'
                          };
                        } else if (lower.includes('chest') || lower.includes('thorax') || lower.includes('lung')) {
                          return {
                            base: 'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20',
                            selected: 'bg-blue-600/30 border-blue-500 text-blue-100 shadow-lg shadow-blue-500/20'
                          };
                        } else if (lower.includes('abdomen') || lower.includes('pelvis')) {
                          return {
                            base: 'bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/20',
                            selected: 'bg-green-600/30 border-green-500 text-green-100 shadow-lg shadow-green-500/20'
                          };
                        } else if (lower.includes('spine') || lower.includes('neck')) {
                          return {
                            base: 'bg-orange-500/10 border-orange-500/30 text-orange-300 hover:bg-orange-500/20',
                            selected: 'bg-orange-600/30 border-orange-500 text-orange-100 shadow-lg shadow-orange-500/20'
                          };
                        } else if (lower.includes('contrast') || lower.includes('gad')) {
                          return {
                            base: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/20',
                            selected: 'bg-yellow-600/30 border-yellow-500 text-yellow-100 shadow-lg shadow-yellow-500/20'
                          };
                        } else if (lower.includes('emergency') || lower.includes('urgent')) {
                          return {
                            base: 'bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20',
                            selected: 'bg-red-600/30 border-red-500 text-red-100 shadow-lg shadow-red-500/20'
                          };
                        } else {
                          return {
                            base: 'bg-gray-500/10 border-gray-500/30 text-gray-300 hover:bg-gray-500/20',
                            selected: 'bg-indigo-600/30 border-indigo-500 text-indigo-100 shadow-lg shadow-indigo-500/20'
                          };
                        }
                      };
                      
                      const style = getTagStyle(tag);
                      const isSelected = selectedTags.includes(tag);
                      
                      return (
                        <button
                          key={tag}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedTags(selectedTags.filter(t => t !== tag));
                            } else {
                              setSelectedTags([...selectedTags, tag]);
                            }
                          }}
                          className={`px-2.5 py-1 rounded-md border transition-all duration-200 text-xs font-medium ${
                            isSelected ? style.selected : style.base
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                    {selectedTags.length > 0 && (
                      <button
                        onClick={() => setSelectedTags([])}
                        className="text-gray-500 hover:text-gray-300 text-xs ml-2"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
            {/* Patients Tab */}
            <TabsContent value="patients" className="space-y-4 pt-4">
            {/* Selection Actions Bar */}
            {selectedPatients.size > 0 && (
              <div className="mb-4 animate-in slide-in-from-top-2 duration-200">
                <div className="bg-gradient-to-r from-indigo-600/10 to-purple-600/10 backdrop-blur-xl border border-indigo-500/30 rounded-xl p-4 shadow-2xl shadow-black/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-indigo-500/20 p-2 rounded-lg">
                        <CheckSquare className="h-5 w-5 text-indigo-400" />
                      </div>
                      <div>
                        <span className="text-white font-semibold text-sm">
                          {selectedPatients.size} patient{selectedPatients.size !== 1 ? 's' : ''} selected
                        </span>
                        <p className="text-gray-400 text-xs">Choose an action below</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExport}
                        className="bg-black/30 border-indigo-500/50 text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-200 transition-all"
                      >
                        <FolderDown className="h-4 w-4 mr-2" />
                        Export
                      </Button>
                      {selectedPatients.size >= 2 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleMerge}
                          className="bg-black/30 border-purple-500/50 text-purple-300 hover:bg-purple-500/20 hover:text-purple-200 transition-all"
                        >
                          <Merge className="h-4 w-4 mr-2" />
                          Merge
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDeleteSelected}
                        className="bg-black/30 border-red-500/50 text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-all"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </Button>
                      <div className="w-px h-6 bg-gray-600/50 mx-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedPatients(new Set())}
                        className="text-gray-400 hover:text-white hover:bg-gray-800/50"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {patientsLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <svg className="h-12 w-12 animate-spin text-indigo-500 mx-auto mb-4" viewBox="0 0 24 24" fill="none">
                    <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.64 5.64L4.22 4.22M19.78 19.78l-1.42-1.42M5.64 18.36L4.22 19.78M19.78 4.22l-1.42 1.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <p className="text-gray-400">Loading patients...</p>
                </div>
              </div>
            ) : filteredPatients.length === 0 ? (
              <Card className="bg-gray-950/90 backdrop-blur-xl border border-gray-600/60 shadow-2xl shadow-black/50">
                <CardContent className="text-center py-16">
                  <div className="bg-gray-800/30 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4">
                    <User className="h-12 w-12 text-gray-500" />
                  </div>
                  <p className="text-gray-300 text-lg font-medium">No patients found</p>
                  <p className="text-gray-500 text-sm mt-2">
                    {searchTerm || selectedTags.length > 0 
                      ? "Try adjusting your search or filters" 
                      : "Upload DICOM files to get started"}
                  </p>
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
                      isSelectable={true}
                      isSelected={selectedPatients.has(patient.id)}
                      onSelectionChange={(selected) => {
                        const newSet = new Set(selectedPatients);
                        if (selected) {
                          newSet.add(patient.id);
                        } else {
                          newSet.delete(patient.id);
                        }
                        setSelectedPatients(newSet);
                      }}
                      onUpdate={() => {
                        queryClient.invalidateQueries({ queryKey: ["/api/patients"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
                        queryClient.invalidateQueries({ queryKey: ["/api/series"] });
                      }}
                      isFavorite={favoritePatients.has(patient.id)}
                      onToggleFavorite={() => toggleFavorite(patient.id)}
                      onPatientOpened={() => trackPatientOpened(patient.id)}
                    />
                  );
                })}
              </div>
            )}
          </TabsContent>



            {/* Import DICOM Tab */}
            <TabsContent value="import" className="space-y-4 p-4">
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
            <TabsContent value="pacs" className="space-y-4 p-4">
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
            <TabsContent value="query" className="space-y-4 p-4">
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

            <TabsContent value="fusion" className="space-y-4 p-4">
              <Card className="bg-gray-950/90 border border-gray-700/60">
                <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle className="text-lg font-semibold">Fusion Manifest Manager</CardTitle>
                    <CardDescription>
                      Review registration files, derived fusion outputs, and trigger manifest runs per patient.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => runManifestMutation.mutate()}
                      disabled={fusionPatientId == null || runManifestMutation.isPending}
                    >
                      {runManifestMutation.isPending ? 'Running…' : 'Run Manifest'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleFusionDebugFetch}
                      disabled={fusionPatientId == null || fusionOverviewFetching}
                    >
                      Debug Data
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => clearFusionMutation.mutate()}
                      disabled={fusionPatientId == null || clearFusionMutation.isPending}
                    >
                      {clearFusionMutation.isPending ? 'Clearing…' : 'Clear Derived'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="fusion-patient-select">Patient</Label>
                    <Select
                      value={fusionPatientId != null ? String(fusionPatientId) : undefined}
                      onValueChange={(value) => setFusionPatientId(Number(value))}
                    >
                      <SelectTrigger id="fusion-patient-select" className="w-full bg-black/40 border border-gray-700/70">
                        <SelectValue placeholder="Select a patient" />
                      </SelectTrigger>
                      <SelectContent>
                        {patients.map((patient) => (
                          <SelectItem key={patient.id} value={String(patient.id)}>
                            {(patient.patientName && patient.patientName.trim()) || patient.patientID || `Patient ${patient.id}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {fusionPatientId == null ? (
                    <p className="text-sm text-gray-400">Choose a patient to inspect fusion data.</p>
                  ) : fusionOverviewLoading && !fusionOverview ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.64 5.64L4.22 4.22M19.78 19.78l-1.42-1.42M5.64 18.36L4.22 19.78M19.78 4.22l-1.42 1.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      Loading fusion overview…
                    </div>
                  ) : fusionOverview ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-gray-700/60 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-wide text-gray-400">Studies</div>
                        <div className="text-xl font-semibold text-white">{fusionOverview.summary.totalStudies}</div>
                      </div>
                      <div className="rounded-lg border border-gray-700/60 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-wide text-gray-400">Series</div>
                        <div className="text-xl font-semibold text-white">{fusionOverview.summary.totalSeries}</div>
                      </div>
                      <div className="rounded-lg border border-gray-700/60 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-wide text-gray-400">Registration Series</div>
                        <div className="text-xl font-semibold text-white">{fusionOverview.summary.registrationSeries}</div>
                      </div>
                      <div className="rounded-lg border border-gray-700/60 bg-black/30 px-4 py-3">
                        <div className="text-xs uppercase tracking-wide text-gray-400">Derived Series</div>
                        <div className="text-xl font-semibold text-white">{fusionOverview.summary.derivedSeries}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No fusion data found for this patient yet.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-gray-950/90 border border-gray-700/60">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Associations</CardTitle>
                  <CardDescription>
                    Mapping between primary CT, secondary modalities, registration files, and derived fused series.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {fusionPatientId == null ? (
                    <p className="text-sm text-gray-400">Select a patient to review fusion associations.</p>
                  ) : fusionOverviewLoading && !fusionOverview ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.64 5.64L4.22 4.22M19.78 19.78l-1.42-1.42M5.64 18.36L4.22 19.78M19.78 4.22l-1.42 1.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      Loading associations…
                    </div>
                  ) : fusionOverview && fusionOverview.associations.length ? (
                    <div className="overflow-x-auto">
                      <div className="grid min-w-[720px] grid-cols-6 gap-px rounded-lg border border-gray-800 bg-gray-800/60 text-xs uppercase tracking-wide text-gray-400">
                        <div className="bg-black/60 px-3 py-2">Status</div>
                        <div className="bg-black/60 px-3 py-2">Primary</div>
                        <div className="bg-black/60 px-3 py-2">Secondary</div>
                        <div className="bg-black/60 px-3 py-2">Registration</div>
                        <div className="bg-black/60 px-3 py-2">Derived</div>
                        <div className="bg-black/60 px-3 py-2">Notes</div>
                      </div>
                      {fusionOverview.associations.map((assoc, index) => {
                        const statusStyle = fusionStatusStyles[assoc.status];
                        const primaryLabel = assoc.primarySeries?.seriesDescription || assoc.primarySeries?.seriesInstanceUID || (assoc.primarySeriesId != null ? `Series #${assoc.primarySeriesId}` : '—');
                        const secondaryLabel = assoc.secondarySeries?.seriesDescription || assoc.secondarySeries?.seriesInstanceUID || (assoc.secondarySeriesId != null ? `Series #${assoc.secondarySeriesId}` : '—');
                        const registrationLabel = assoc.registrationSeries?.seriesDescription || assoc.registrationSeries?.seriesInstanceUID || (assoc.registrationSeriesId != null ? `Series #${assoc.registrationSeriesId}` : '—');
                        const derivedLabel = assoc.derivedSeries?.seriesDescription || (assoc.derivedSeriesId != null ? `Series #${assoc.derivedSeriesId}` : 'Pending');
                        const markerText = assoc.markers?.length ? assoc.markers.join(', ') : null;
                        return (
                          <div key={`${assoc.primarySeriesId}-${assoc.secondarySeriesId}-${assoc.registrationSeriesId}-${index}`} className="grid min-w-[720px] grid-cols-6 gap-px border-b border-gray-800/40 bg-gray-900/60 text-sm">
                            <div className="bg-black/40 px-3 py-2">
                              <Badge className={statusStyle.className}>{statusStyle.label}</Badge>
                            </div>
                            <div className="bg-black/40 px-3 py-2">
                              <div className="font-medium text-gray-100">{primaryLabel || '—'}</div>
                              <div className="text-xs text-gray-500">{assoc.primarySeries?.modality || ''}</div>
                            </div>
                            <div className="bg-black/40 px-3 py-2">
                              <div className="font-medium text-gray-100">{secondaryLabel || '—'}</div>
                              <div className="text-xs text-gray-500">{assoc.secondarySeries?.modality || ''}</div>
                            </div>
                            <div className="bg-black/40 px-3 py-2">
                              <div className="text-gray-100">{registrationLabel || '—'}</div>
                              <div className="text-xs text-gray-500 truncate">{assoc.registrationFilePath || '—'}</div>
                            </div>
                            <div className="bg-black/40 px-3 py-2">
                              <div className="text-gray-100">{derivedLabel}</div>
                              {markerText && <div className="text-xs text-indigo-300">{markerText}</div>}
                            </div>
                            <div className="bg-black/40 px-3 py-2 text-xs text-gray-400">
                              {assoc.reason || assoc.transformSource || '—'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No fusion associations found yet for this patient.</p>
                  )}
                </CardContent>
              </Card>

              {fusionOverview && fusionOverview.studies.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {fusionOverview.studies.map((study) => {
                    const derivedIds = new Set(study.derivedSeries.map((d) => d.id));
                    const registrationIds = new Set(study.registrationSeries.map((r) => r.id));
                    const baselineSeries = study.series.filter((series) => !derivedIds.has(series.id) && !registrationIds.has(series.id));
                    return (
                      <Card key={study.id} className="bg-gray-950/90 border border-gray-700/60">
                        <CardHeader>
                          <CardTitle className="text-base font-semibold">{study.studyDescription || study.studyInstanceUID}</CardTitle>
                          <CardDescription>
                            {study.studyDate ? `Date ${study.studyDate}` : 'Study'} • {Object.entries(study.modalityCounts).map(([modality, count]) => `${modality}: ${count}`).join(' · ')}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div>
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-200">Primary / Original Series</h4>
                            {baselineSeries.length ? (
                              <ul className="space-y-2 text-sm text-gray-200">
                                {baselineSeries.map((series) => (
                                  <li key={series.id} className="rounded border border-gray-800/40 bg-black/30 px-3 py-2">
                                    <div className="font-medium">{series.seriesDescription || series.seriesInstanceUID}</div>
                                    <div className="text-xs text-gray-500">Modality {series.modality || '—'} · Images {series.imageCount ?? '—'}</div>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-xs text-gray-500">No baseline series recorded.</p>
                            )}
                          </div>

                          <div>
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-200">Registration Files</h4>
                            {study.registrationSeries.length ? (
                              <ul className="space-y-2 text-sm text-gray-200">
                                {study.registrationSeries.map((series) => (
                                  <li key={series.id} className="rounded border border-sky-900/40 bg-sky-950/20 px-3 py-2">
                                    <div className="font-medium">{series.seriesDescription || series.seriesInstanceUID}</div>
                                    <div className="text-xs text-gray-400 truncate">{series.filePath || 'Missing file'}</div>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-xs text-gray-500">No REG files detected for this study.</p>
                            )}
                          </div>

                          <div>
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-200">Derived Series</h4>
                            {study.derivedSeries.length ? (
                              <ul className="space-y-2 text-sm text-gray-200">
                                {study.derivedSeries.map((series) => (
                                  <li key={series.id} className="rounded border border-emerald-900/40 bg-emerald-950/20 px-3 py-2">
                                    <div className="font-medium">{series.seriesDescription || series.seriesInstanceUID}</div>
                                    <div className="text-xs text-gray-300">Markers: {series.fusion.markers.join(', ')}</div>
                                    {series.fusion.outputDirectory && (
                                      <div className="text-xs text-gray-500 truncate">{series.fusion.outputDirectory}</div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-xs text-gray-500">No derived series generated yet.</p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : fusionPatientId != null && !fusionOverviewLoading ? (
                <Card className="bg-gray-950/90 border border-gray-700/60">
                  <CardContent className="py-6 text-center text-sm text-gray-400">
                    No fusion studies available for this patient yet.
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>

            {/* Metadata Tab */}
            <TabsContent value="metadata" className="space-y-4 p-4">
              <MetadataViewer />
            </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Right Sidebar with glassmorphic design - increased thickness */}
        <div className="w-96 flex flex-col h-full">
          <div className="m-4 space-y-3 overflow-y-auto flex-1">
            <Accordion type="multiple" defaultValue={["recently-opened", "favorites", "recently-imported"]} className="space-y-3">
              {/* Recently Opened - Blue Theme */}
              <AccordionItem value="recently-opened" className="bg-gray-950/95 backdrop-blur-2xl border border-blue-500/40 rounded-xl overflow-hidden shadow-2xl shadow-black/50">
                <AccordionTrigger className="px-4 py-3 hover:bg-blue-500/10 transition-all">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-blue-400" />
                    <span className="text-white font-medium text-sm">Recently Opened</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {recentlyOpenedPatients.length === 0 ? (
                      <p className="text-gray-500 text-sm py-3 px-3">No recently opened patients</p>
                    ) : (
                      recentlyOpenedPatients.map(patientId => {
                        const patient = patients.find(p => p.id === patientId);
                        return patient ? (
                          <Link 
                            key={patientId}
                            href={`/enhanced-viewer?patientId=${patient.patientID}`}
                            className="block p-3 rounded-lg bg-blue-500/5 hover:bg-blue-500/15 transition-all border border-blue-500/20 hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/10"
                            onClick={() => trackPatientOpened(patientId)}
                          >
                            <div className="text-white text-sm font-medium">{patient.patientName}</div>
                            <div className="text-blue-400 text-xs mt-1">ID: {patient.patientID}</div>
                          </Link>
                        ) : null;
                      })
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Favorites - Yellow Theme */}
              <AccordionItem value="favorites" className="bg-gray-950/95 backdrop-blur-2xl border border-yellow-500/40 rounded-xl overflow-hidden shadow-2xl shadow-black/50">
                <AccordionTrigger className="px-4 py-3 hover:bg-yellow-500/10 transition-all">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-yellow-400" />
                    <span className="text-white font-medium text-sm">Favorites</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {favoritePatients.size === 0 ? (
                      <p className="text-gray-500 text-sm py-3 px-3">No favorite patients</p>
                    ) : (
                      Array.from(favoritePatients).map(patientId => {
                        const patient = patients.find(p => p.id === patientId);
                        return patient ? (
                          <Link 
                            key={patientId}
                            href={`/enhanced-viewer?patientId=${patient.patientID}`}
                            className="block p-3 rounded-lg bg-yellow-500/5 hover:bg-yellow-500/15 transition-all border border-yellow-500/20 hover:border-yellow-500/30 hover:shadow-lg hover:shadow-yellow-500/10"
                            onClick={() => trackPatientOpened(patientId)}
                          >
                            <div className="text-white text-sm font-medium">{patient.patientName}</div>
                            <div className="text-yellow-400 text-xs mt-1">ID: {patient.patientID}</div>
                          </Link>
                        ) : null;
                      })
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Recently Imported - Green Theme */}
              <AccordionItem value="recently-imported" className="bg-gray-950/95 backdrop-blur-2xl border border-green-500/40 rounded-xl overflow-hidden shadow-2xl shadow-black/50">
                <AccordionTrigger className="px-4 py-3 hover:bg-green-500/10 transition-all">
                  <div className="flex items-center gap-2">
                    <Import className="h-4 w-4 text-green-400" />
                    <span className="text-white font-medium text-sm">Recently Imported</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {recentlyImportedPatients.length === 0 ? (
                      <p className="text-gray-500 text-sm py-3 px-3">No recently imported patients</p>
                    ) : (
                      recentlyImportedPatients.map(importEntry => {
                        const patient = patients.find(p => p.id === importEntry.patientId || p.patientID === importEntry.patientId);
                        return patient ? (
                          <Link 
                            key={importEntry.patientId}
                            href={`/enhanced-viewer?patientId=${patient.patientID}`}
                            className="block p-4 rounded-lg bg-gradient-to-r from-green-500/5 to-emerald-500/5 hover:from-green-500/15 hover:to-emerald-500/15 transition-all border border-green-500/20 hover:border-green-500/30 hover:shadow-lg hover:shadow-green-500/10"
                            onClick={() => trackPatientOpened(typeof importEntry.patientId === 'number' ? importEntry.patientId : parseInt(importEntry.patientId.toString()))}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="text-white text-sm font-medium">{patient.patientName}</div>
                                <div className="text-green-400 text-xs mt-1">ID: {patient.patientID}</div>
                              </div>
                              <div className="text-right ml-3">
                                <div className="text-green-300 text-xs font-medium">
                                  {new Date(importEntry.importDate).toLocaleDateString()}
                                </div>
                                <div className="text-green-400/70 text-[10px] mt-0.5">
                                  {new Date(importEntry.importDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                            </div>
                          </Link>
                        ) : null;
                      })
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>
      </div>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="bg-gray-900 border-gray-700 max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-white">Export DICOM Files</DialogTitle>
            <DialogDescription className="text-gray-400">
              Select the series you want to export
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {exportItems.map((item) => (
              <div key={item.id} className="flex items-center space-x-3 p-3 rounded hover:bg-gray-800/50">
                <Checkbox
                  id={item.id}
                  checked={selectedExportItems.has(item.id)}
                  onCheckedChange={(checked) => {
                    const newSet = new Set(selectedExportItems);
                    if (checked) {
                      newSet.add(item.id);
                    } else {
                      newSet.delete(item.id);
                    }
                    setSelectedExportItems(newSet);
                  }}
                  className="border-gray-600 data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                />
                <label htmlFor={item.id} className="flex-1 cursor-pointer">
                  <div className="text-white font-medium">{item.name}</div>
                  <div className="text-gray-400 text-sm">{item.description}</div>
                </label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowExportDialog(false)}
              className="border-gray-600 text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleExportConfirm}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Export Selected ({selectedExportItems.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent className="bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Merge Patients</DialogTitle>
            <DialogDescription className="text-gray-400">
              Choose how to merge the selected patients
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-white">Merge Option</Label>
              <Select defaultValue="existing">
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="existing" className="text-white hover:bg-gray-700">
                    Merge into existing patient
                  </SelectItem>
                  <SelectItem value="new" className="text-white hover:bg-gray-700">
                    Merge into new patient
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label className="text-white">Selected Patients</Label>
              <div className="bg-gray-800 rounded p-3 space-y-2">
                {Array.from(selectedPatients).map(patientId => {
                  const patient = patients.find(p => p.id === patientId);
                  return patient ? (
                    <div key={patientId} className="text-gray-300">
                      {patient.patientName} (ID: {patient.patientID})
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowMergeDialog(false)}
              className="border-gray-600 text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button
              onClick={() => handleMergeConfirm('existing')}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Merge Patients
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
