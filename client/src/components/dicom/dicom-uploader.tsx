import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Upload, FileCheck, AlertCircle, X, Download, Database, CheckCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { PatientPreviewCard } from './patient-preview-card';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

interface DICOMMetadata {
  filename: string;
  modality?: string;
  patientID?: string;
  patientName?: string;
  studyDate?: string;
  seriesDescription?: string;
  sopClassUID?: string;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  instanceNumber?: number;
  seriesNumber?: number;
  error?: string;
  structureSetDate?: string;
  structures?: Array<{ name: string; color?: [number, number, number] }>;
}

interface RTStructDetails {
  [filename: string]: {
    structureSetDate?: string;
    structures: Array<[string, [number, number, number] | null]>;
  };
}

interface PatientPreview {
  patientId: string;
  patientName: string;
  studies: Array<{
    studyId: string;
    studyDate: string;
    seriesCount: number;
    imageCount: number;
    modalities: string[];
  }>;
}

interface ParseResult {
  success: boolean;
  data: DICOMMetadata[];
  rtstructDetails: RTStructDetails;
  totalFiles: number;
  message: string;
  patientPreviews?: PatientPreview[];
}

interface ParseSession {
  sessionId: string;
  status: 'parsing' | 'complete' | 'error';
  progress: number;
  total: number;
  currentFile?: string;
  result?: ParseResult;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

interface UnprocessedFile {
  sessionId: string;
  uploadTime: string;
  fileCount: number;
  path: string;
}

// Step types for the upload process
type UploadStep = 'upload' | 'parse' | 'triage' | 'import' | 'complete';

interface StepInfo {
  step: UploadStep;
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  detail?: string;
}

export function DICOMUploader() {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState<UploadStep | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Record<UploadStep, StepInfo>>({
    upload: { step: 'upload', label: 'Upload Files', status: 'pending' },
    parse: { step: 'parse', label: 'Extract Metadata', status: 'pending' },
    triage: { step: 'triage', label: 'Review Files', status: 'pending' },
    import: { step: 'import', label: 'Import to Database', status: 'pending' },
    complete: { step: 'complete', label: 'Complete', status: 'pending' }
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseSession, setParseSession] = useState<ParseSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [unprocessedFiles, setUnprocessedFiles] = useState<UnprocessedFile[]>([]);
  const [triageSessions, setTriageSessions] = useState<any[]>([]);
  const [processingMessage, setProcessingMessage] = useState<string>('');
  const [importMessage, setImportMessage] = useState<string>('');
  const [importSuccess, setImportSuccess] = useState<{
    patientCount: number;
    imageCount: number;
    patientPreviews?: any[];
    timestamp: number;
  } | null>(null);

  const [processingFileId, setProcessingFileId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  // Helper function to update step status
  const updateStepStatus = (step: UploadStep, status: 'pending' | 'active' | 'complete' | 'error', detail?: string) => {
    setStepStatuses(prev => ({
      ...prev,
      [step]: { ...prev[step], status, detail }
    }));
    if (status === 'active') {
      setCurrentStep(step);
    }
  };

  // Poll for session status (not using useCallback to avoid dependency issues)
  const pollSessionStatus = async (sessionId: string) => {
    console.log('Polling session status for:', sessionId);
    try {
      const response = await fetch(`/api/parse-dicom-session/${sessionId}`);
      if (!response.ok) {
        throw new Error('Failed to check session status');
      }
      
      const session: ParseSession = await response.json();
      console.log('Session status:', session.status, 'Progress:', session.progress, '/', session.total);
      setParseSession(session);
      
      // Update progress and status message
      if (session.total > 0) {
        setUploadProgress(Math.round((session.progress / session.total) * 100));
      }
      
      // Show current file being processed
      if (session.currentFile) {
        setProcessingMessage(`Processing file ${session.progress} of ${session.total}: ${session.currentFile}`);
      } else if (session.status === 'parsing') {
        setProcessingMessage(`Processing ${session.progress} of ${session.total} files...`);
      }
      
      // If complete, check for triage session and load it directly
      if (session.status === 'complete' && session.result) {
        setParseResult(session.result);
        setIsUploading(false);
        setProcessingFileId(null);
        localStorage.removeItem('currentParseSessionId');
        localStorage.removeItem('uploadActive');
        
        // Auto-refresh both unprocessed files and triage sessions
        checkUnprocessedFiles();
        checkTriageSessions();
      } else if (session.status === 'error') {
        setError(session.error || 'Parsing failed');
        setIsUploading(false);
        localStorage.removeItem('currentParseSessionId');
        localStorage.removeItem('uploadActive');
      } else {
        // Continue polling - use shorter interval initially for faster feedback
        const pollInterval = session.progress < 10 ? 100 : 500;
        setTimeout(() => pollSessionStatus(sessionId), pollInterval);
      }
    } catch (error) {
      console.error('Error polling session:', error);
      setError('Failed to check parsing status');
      setIsUploading(false);
      localStorage.removeItem('currentParseSessionId');
      localStorage.removeItem('uploadActive');
    }
  };

  // Check for existing session and unprocessed files on mount
  useEffect(() => {
    const sessionId = localStorage.getItem('currentParseSessionId');
    console.log('Checking for existing session on mount:', sessionId);
    if (sessionId) {
      setSavedSessionId(sessionId);
      setIsUploading(true);
      pollSessionStatus(sessionId);
    }
    
    // Check for unprocessed files and triage sessions immediately
    checkUnprocessedFiles();
    checkTriageSessions();
    
    // Poll for both unprocessed files and triage sessions every 3 seconds
    const interval = setInterval(() => {
      checkUnprocessedFiles();
      checkTriageSessions();
    }, 3000);
    
    return () => clearInterval(interval);
  }, []); // Empty dependency array - only run on mount
  
  const checkUnprocessedFiles = async () => {
    try {
      const response = await fetch('/api/unprocessed-files');
      if (response.ok) {
        const data = await response.json();
        setUnprocessedFiles(data.files || []);
      }
    } catch (error) {
      console.error('Error checking unprocessed files:', error);
    }
  };

  const checkTriageSessions = async () => {
    try {
      const response = await fetch('/api/triage-sessions');
      if (response.ok) {
        const data = await response.json();
        setTriageSessions(data.sessions || []);
      }
    } catch (error) {
      console.error('Error checking triage sessions:', error);
    }
  };



  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    console.log(`Selected ${acceptedFiles.length} files for upload`);
    
    // Show warning if partial selection might have occurred
    if (acceptedFiles.length === 500 || acceptedFiles.length === 1000) {
      setError(`Note: Exactly ${acceptedFiles.length} files selected. Browser may have limited selection. Consider using ZIP format for large datasets.`);
    }

    setIsUploading(true);
    setParseResult(null);
    setParseSession(null);
    setImportSuccess(null); // Clear any previous import success state
    setUploadProgress(0);
    
    // Set upload active flag for global tracking
    localStorage.setItem('uploadActive', 'true');

    try {
      const formData = new FormData();
      acceptedFiles.forEach(file => {
        formData.append('files', file);
      });
      
      // Log file count and total size
      const totalSize = acceptedFiles.reduce((sum, file) => sum + file.size, 0);
      console.log(`Uploading ${acceptedFiles.length} files, total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

      // Start parsing session
      const response = await fetch('/api/parse-dicom-session', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start parsing session');
      }

      const data = await response.json();
      const sessionId = data.sessionId;
      console.log('Started parsing session:', sessionId);
      
      // Save session ID to localStorage
      localStorage.setItem('currentParseSessionId', sessionId);
      console.log('Saved to localStorage:', localStorage.getItem('currentParseSessionId'));
      setSavedSessionId(sessionId);
      
      // Set initial progress to show activity immediately
      setUploadProgress(1);
      
      // Start polling for progress immediately
      pollSessionStatus(sessionId);

    } catch (error) {
      console.error('Upload error:', error);
      setError(error instanceof Error ? error.message : 'Upload failed');
      setIsUploading(false);
      localStorage.removeItem('uploadActive');
    }
  };

  const { toast } = useToast();
  
  const handleImportToDatabase = async () => {
    if (!parseResult) return;

    setIsImporting(true);
    setError(null);
    updateStepStatus('triage', 'complete');
    updateStepStatus('import', 'active', 'Importing to database...');
    setImportMessage('Starting import process...');

    try {
      // Check if this came from triage - use the better import endpoint
      const triageSessionsResponse = await fetch('/api/triage-sessions');
      if (triageSessionsResponse.ok) {
        const triageData = await triageSessionsResponse.json();
        console.log('Available triage sessions:', triageData.sessions?.length);
        console.log('Looking for data length:', parseResult.data?.length);
        
        const matchingTriage = triageData.sessions?.find(s => 
          s.parseResult?.data?.length === parseResult.data?.length
        );
        
        console.log('Found matching triage:', !!matchingTriage);
        
        if (matchingTriage) {
          console.log('Using triage import for session:', matchingTriage.sessionId);
          setImportMessage('Moving files to permanent storage...');
          // Use triage import endpoint
          const response = await fetch('/api/import-triage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: matchingTriage.sessionId })
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error('Triage import failed:', errorText);
            throw new Error(`Failed to import from triage: ${errorText}`);
          }
          
          console.log('Triage import successful');
          
          // Update step status
          updateStepStatus('import', 'complete', `${parseResult.data?.length || 0} images imported`);
          updateStepStatus('complete', 'complete');
          
          // Show success toast
          toast({
            title: "Import successful",
            description: `Successfully imported ${parseResult.patientPreviews?.length || 1} patients with ${parseResult.data?.length || 0} images.`,
          });

          // Post-import cleanup of orphan/derived series for imported patients
          try {
            if (matchingTriage.parseResult?.patientPreviews?.length) {
              const previews = matchingTriage.parseResult.patientPreviews as any[];
              // Fetch current patients to map DICOM patientID -> DB id
              const patientsResp = await fetch('/api/patients');
              const patientsList = patientsResp.ok ? await patientsResp.json() : [];
              for (const p of previews) {
                const dicomId = p.patientId || p.patientID || p.id;
                if (!dicomId) continue;
                const match = patientsList.find((row: any) => String(row.patientID) === String(dicomId));
                if (match?.id) {
                  try { await fetch(`/api/patients/${match.id}/cleanup-series`, { method: 'POST' }); } catch {}
                }
              }
            }
          } catch {}
          
          // Track recently imported patients with timestamps
          if (parseResult.patientPreviews) {
            const importTimestamp = Date.now();
            parseResult.patientPreviews.forEach(patient => {
              // Update recently imported with timestamp
              const recentlyImported = JSON.parse(localStorage.getItem('recentlyImportedPatients') || '[]');
              const newEntry = { patientId: patient.patientId || patient.id, importDate: importTimestamp };
              const updated = [newEntry, ...recentlyImported.filter((item: any) => item.patientId !== newEntry.patientId)].slice(0, 10);
              localStorage.setItem('recentlyImportedPatients', JSON.stringify(updated));
            });
            // Trigger storage event to update patient manager
            window.dispatchEvent(new Event('recentlyImportedUpdated'));
          }
          
          // Invalidate queries to refresh the UI
          queryClient.invalidateQueries({ queryKey: ['/api/patients'] });
          queryClient.invalidateQueries({ queryKey: ['/api/studies'] });
          queryClient.invalidateQueries({ queryKey: ['/api/series'] });
          
          // Show import success summary instead of immediately redirecting
          setImportSuccess({
            patientCount: parseResult.patientPreviews?.length || 1,
            imageCount: parseResult.data?.length || 0,
            patientPreviews: parseResult.patientPreviews,
            timestamp: Date.now()
          });
          
          // Clean up but don't redirect yet - let user see the success summary
          setParseResult(null);
          setParseSession(null);
          return;
        }
      }

      // Fallback to regular import
      const response = await apiRequest('POST', '/api/import-dicom-metadata', {
        data: parseResult.data,
        rtstructDetails: parseResult.rtstructDetails
      });

      // Update step status
      updateStepStatus('import', 'complete', 'Import completed');
      updateStepStatus('complete', 'complete');
      
      // Show success toast
      toast({
        title: "Import successful",
        description: `Successfully imported ${parseResult.patientPreviews?.length || 0} patients with their studies and series.`,
      });

      // Post-import cleanup of orphan/derived series for imported patients
      try {
        if (parseResult.patientPreviews?.length) {
          const previews = parseResult.patientPreviews as any[];
          const patientsResp = await fetch('/api/patients');
          const patientsList = patientsResp.ok ? await patientsResp.json() : [];
          for (const p of previews) {
            const dicomId = p.patientId || p.patientID || p.id;
            if (!dicomId) continue;
            const match = patientsList.find((row: any) => String(row.patientID) === String(dicomId));
            if (match?.id) {
              try { await fetch(`/api/patients/${match.id}/cleanup-series`, { method: 'POST' }); } catch {}
            }
          }
        }
      } catch {}

      // Track recently imported patients with timestamps
      if (parseResult.patientPreviews) {
        const importTimestamp = Date.now();
        parseResult.patientPreviews.forEach(patient => {
          // Update recently imported with timestamp
          const recentlyImported = JSON.parse(localStorage.getItem('recentlyImportedPatients') || '[]');
          const newEntry = { patientId: patient.patientId || patient.id, importDate: importTimestamp };
          const updated = [newEntry, ...recentlyImported.filter((item: any) => item.patientId !== newEntry.patientId)].slice(0, 10);
          localStorage.setItem('recentlyImportedPatients', JSON.stringify(updated));
        });
        // Trigger storage event to update patient manager
        window.dispatchEvent(new Event('recentlyImportedUpdated'));
      }

      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/patients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/studies'] });

      // Clean up the uploaded files after successful import
      if (parseSession?.uploadSessionId) {
        try {
          await fetch(`/api/unprocessed-files/${parseSession.uploadSessionId}`, {
            method: 'DELETE'
          });
        } catch (e) {
          console.error('Failed to clean up files:', e);
        }
      }

      // Show import success summary instead of immediately redirecting
      setImportSuccess({
        patientCount: parseResult.patientPreviews?.length || 0,
        imageCount: parseResult.data?.length || 0,
        patientPreviews: parseResult.patientPreviews,
        timestamp: Date.now()
      });
      
      // Clear results but don't redirect yet - let user see the success summary
      setParseResult(null);
      
    } catch (error) {
      console.error('Import error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Import failed';
      setError(errorMessage);
      
      // Show error toast
      toast({
        title: "Import failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const exportMetadata = () => {
    if (!parseResult) return;

    const dataStr = JSON.stringify(parseResult, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dicom-metadata-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  const handleProcessUnprocessedFiles = async (sessionId: string) => {
    console.log('Processing unprocessed files for sessionId:', sessionId);
    setProcessingFileId(sessionId);
    
    try {
      const unprocessedFile = unprocessedFiles.find(f => f.sessionId === sessionId);
      if (!unprocessedFile) {
        console.error('Unprocessed file not found for sessionId:', sessionId);
        setProcessingFileId(null);
        return;
      }
      
      // Clear any existing state
      setParseResult(null);
      setError(null);
      
      // Create a new parse session from existing upload directory
      const parseResponse = await fetch('/api/parse-dicom-session/from-existing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadSessionId: sessionId })
      });
      
      if (!parseResponse.ok) {
        const errorData = await parseResponse.json();
        throw new Error(errorData.error || 'Failed to start parsing session');
      }
      
      const data = await parseResponse.json();
      console.log('Started parsing session:', data.sessionId);
      
      // Save session ID and start polling
      localStorage.setItem('currentParseSessionId', data.sessionId);
      setSavedSessionId(data.sessionId);
      setIsUploading(true);
      setUploadProgress(1);
      pollSessionStatus(data.sessionId);
      
      // Remove from unprocessed list immediately
      setUnprocessedFiles(prev => prev.filter(f => f.sessionId !== sessionId));
      
    } catch (error) {
      console.error('Error processing files:', error);
      setError(error instanceof Error ? error.message : 'Failed to process files');
    } finally {
      setProcessingFileId(null);
    }
  };
  
  const handleDeleteUnprocessedFiles = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/unprocessed-files/${sessionId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete files');
      }
      
      // Remove from list
      setUnprocessedFiles(prev => prev.filter(f => f.sessionId !== sessionId));
      
      // Refresh the list
      checkUnprocessedFiles();
      
    } catch (error) {
      console.error('Error deleting files:', error);
      setError('Failed to delete files');
    }
  };

  const handleImportTriageSession = async (sessionId: string) => {
    try {
      setIsImporting(true);
      setError(null);
      setImportMessage('Moving files to permanent storage...');
      
      // Get the session data to track imported patients
      const sessionData = triageSessions.find(s => s.sessionId === sessionId);
      
      // Use the enhanced triage import endpoint
      const response = await fetch('/api/import-triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Triage import failed:', errorText);
        throw new Error(`Failed to import from triage: ${errorText}`);
      }
      
      console.log('Triage import successful');
      
      // Update step status
      updateStepStatus('import', 'complete', 'Import completed');
      updateStepStatus('complete', 'complete');
      
      // Show success toast
      const patientCount = sessionData?.parseResult?.patientPreviews?.length || 0;
      const imageCount = sessionData?.parseResult?.data?.length || 0;
      toast({
        title: "Import successful",
        description: `Successfully imported ${patientCount} patient${patientCount !== 1 ? 's' : ''} with ${imageCount} images.`,
      });
      
      // Track recently imported patients with timestamps
      if (sessionData?.parseResult?.patientPreviews) {
        const importTimestamp = Date.now();
        sessionData.parseResult.patientPreviews.forEach(patient => {
          // Update recently imported with timestamp
          const recentlyImported = JSON.parse(localStorage.getItem('recentlyImportedPatients') || '[]');
          const newEntry = { patientId: patient.patientId || patient.patientID || patient.id, importDate: importTimestamp };
          const updated = [newEntry, ...recentlyImported.filter((item: any) => item.patientId !== newEntry.patientId)].slice(0, 10);
          localStorage.setItem('recentlyImportedPatients', JSON.stringify(updated));
        });
        // Trigger storage event to update patient manager
        window.dispatchEvent(new Event('recentlyImportedUpdated'));
      }
      
      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/patients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/studies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/series'] });
      
      // Show import success summary instead of immediately redirecting
      setImportSuccess({
        patientCount: patientCount,
        imageCount: imageCount,
        patientPreviews: sessionData?.parseResult?.patientPreviews,
        timestamp: Date.now()
      });
      
      // Remove from triage list and refresh
      setTriageSessions(prev => prev.filter(s => s.sessionId !== sessionId));
      checkTriageSessions();
      checkUnprocessedFiles();
      
    } catch (error) {
      console.error('Error importing triage session:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to import session';
      setError(errorMessage);
      
      // Show error toast
      toast({
        title: "Import failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleDeleteTriageSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/triage-sessions/${sessionId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete triage session');
      }
      
      // Remove from list
      setTriageSessions(prev => prev.filter(s => s.sessionId !== sessionId));
      
    } catch (error) {
      console.error('Error deleting triage session:', error);
      setError('Failed to delete triage session');
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/dicom': ['.dcm'],
      'application/octet-stream': ['.dcm'],
      'application/zip': ['.zip']
    },
    disabled: isUploading,
    multiple: true,
    maxFiles: 5000, // Increased limit for large datasets
    noClick: false,
    noKeyboard: false
  });

  const getModalityColor = (modality?: string) => {
    switch (modality) {
      case 'CT': return 'bg-blue-500';
      case 'MR': return 'bg-green-500';
      case 'RTSTRUCT': return 'bg-purple-500';
      case 'RTDOSE': return 'bg-orange-500';
      case 'RTPLAN': return 'bg-red-500';
      case 'PET': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="space-y-6">

      {/* Upload Area - Always at top */}
      <Card className="border-2 border-dashed border-indigo-600 bg-black/20">
        <div
          {...getRootProps()}
          className={`p-8 text-center cursor-pointer transition-colors ${
            isDragActive ? 'bg-indigo-800/20' : 'hover:bg-indigo-800/10'
          } ${isUploading ? 'pointer-events-none opacity-50' : ''}`}
        >
          <input {...getInputProps()} />
          <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragActive ? 'text-indigo-400' : 'text-indigo-500'}`} />
          
          {isUploading ? (
            <div className="space-y-6">
              <p className="text-lg text-white">
                Processing DICOM Data
              </p>
              
              {/* Step-based Progress Indicator */}
              <div className="w-full max-w-2xl mx-auto">
                <div className="relative">
                  {/* Progress Line */}
                  <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-700"></div>
                  <div 
                    className="absolute top-5 left-0 h-0.5 bg-indigo-500 transition-all duration-300"
                    style={{ 
                      width: `${currentStep === 'upload' ? '0%' : 
                               currentStep === 'parse' ? '25%' : 
                               currentStep === 'triage' ? '50%' : 
                               currentStep === 'import' ? '75%' : 
                               currentStep === 'complete' ? '100%' : '0%'}` 
                    }}
                  ></div>
                  
                  {/* Steps */}
                  <div className="relative flex justify-between">
                    {Object.values(stepStatuses).map((stepInfo, index) => (
                      <div key={stepInfo.step} className="flex flex-col items-center">
                        <div className={`
                          w-10 h-10 rounded-full flex items-center justify-center text-white font-medium
                          ${stepInfo.status === 'complete' ? 'bg-green-500' : 
                            stepInfo.status === 'active' ? 'bg-indigo-500 animate-pulse' : 
                            stepInfo.status === 'error' ? 'bg-red-500' : 
                            'bg-gray-700'}
                        `}>
                          {stepInfo.status === 'complete' ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : stepInfo.status === 'active' ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : stepInfo.status === 'error' ? (
                            <AlertCircle className="w-5 h-5" />
                          ) : (
                            <span className="text-xs">{index + 1}</span>
                          )}
                        </div>
                        <span className={`
                          mt-2 text-xs font-medium
                          ${stepInfo.status === 'active' ? 'text-indigo-400' : 
                            stepInfo.status === 'complete' ? 'text-green-400' : 
                            'text-gray-500'}
                        `}>
                          {stepInfo.label}
                        </span>
                        {stepInfo.detail && stepInfo.status === 'active' && (
                          <span className="text-xs text-gray-400 mt-1">
                            {stepInfo.detail}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Current Status Message */}
              {processingMessage && (
                <div className="space-y-2 text-center">
                  <p className="text-sm text-gray-300">
                    {processingMessage}
                  </p>
                  <p className="text-xs text-gray-500 italic">
                    You can navigate away - processing continues in background
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-lg text-white">
                {isDragActive ? 'Drop DICOM files here' : 'Drag & drop DICOM files here'}
              </p>
              <p className="text-sm text-gray-400">
                Supports .dcm files, ZIP archives, and folders
              </p>
              <div className="space-y-3">
                <Button variant="outline" className="border-indigo-600 text-indigo-300">
                  Click to browse files
                </Button>
                <div className="text-xs text-gray-600 space-y-1">
                  <p>Up to 5000 files per batch</p>
                  <p>ZIP format recommended for large datasets</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Session Recovery Notice */}
      {savedSessionId && isUploading && !parseSession && (
        <Card className="border-yellow-600 bg-yellow-900/20">
          <div className="p-4">
            <p className="text-yellow-300 text-sm">
              Recovering parsing session {savedSessionId}...
            </p>
          </div>
        </Card>
      )}

      {/* Ready to Import - Triage Sessions (Only show when no current parseResult to avoid confusion) */}
      {triageSessions.length > 0 && !isUploading && !parseResult && (
        <Card className="border-amber-500/40 bg-gradient-to-br from-amber-900/20 to-orange-900/20 backdrop-blur-xl shadow-2xl">
          <CardHeader>
            <CardTitle className="text-amber-300 flex items-center gap-3">
              <FileCheck className="w-6 h-6" />
              Previously Uploaded Sessions
            </CardTitle>
            <p className="text-amber-200 text-sm leading-relaxed">
              Found {triageSessions.length} session{triageSessions.length > 1 ? 's' : ''} ready for import. These files have been analyzed and can be imported directly.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {triageSessions.map((session) => (
              <div key={session.sessionId} className="border border-amber-500/20 bg-black/20 backdrop-blur-sm rounded-xl p-5 hover:bg-black/30 transition-all duration-200">
                {/* Session Summary */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-semibold mb-1">
                      {session.parseResult?.patientPreviews?.length || 1} patient{(session.parseResult?.patientPreviews?.length || 1) !== 1 ? 's' : ''} • {session.parseResult?.data?.length || session.parseResult?.totalFiles || 0} images
                    </p>
                    <p className="text-sm text-amber-200">
                      Uploaded {new Date(session.timestamp).toLocaleDateString()} at {new Date(session.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      size="sm"
                      onClick={() => handleImportTriageSession(session.sessionId)}
                      disabled={isImporting}
                      className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-semibold shadow-lg hover:shadow-amber-500/25 transition-all duration-200"
                    >
                      <Database className="w-4 h-4 mr-2" />
                      {isImporting ? (importMessage || 'Importing...') : 'Import Session'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteTriageSession(session.sessionId)}
                      className="border-red-500/50 text-red-300 hover:bg-red-600/20 hover:border-red-500 transition-all duration-200"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                
                {/* Patient Details */}
                {session.parseResult?.patientPreviews && session.parseResult.patientPreviews.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {session.parseResult.patientPreviews.map((patient: any, idx: number) => (
                      <div key={idx} className="bg-gray-800/50 rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-white font-medium">{patient.patientName || 'Anonymous'}</p>
                            <p className="text-sm text-gray-400">ID: {patient.patientID} • {patient.studyCount} studies</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-300">{patient.totalImages} images</p>
                            <p className="text-xs text-gray-500">{patient.modalities?.join(', ')}</p>
                          </div>
                        </div>
                        
                        {/* RT Structures if present */}
                        {patient.rtStructures && patient.rtStructures.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-700">
                            <p className="text-xs text-gray-400 mb-1">RT Structures:</p>
                            <div className="flex flex-wrap gap-1">
                              {patient.rtStructures.slice(0, 5).map((struct: any, structIdx: number) => (
                                <span 
                                  key={structIdx}
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{ 
                                    backgroundColor: `rgba(${struct.color[0]}, ${struct.color[1]}, ${struct.color[2]}, 0.3)`,
                                    color: `rgb(${struct.color[0]}, ${struct.color[1]}, ${struct.color[2]})`
                                  }}
                                >
                                  {struct.name}
                                </span>
                              ))}
                              {patient.rtStructures.length > 5 && (
                                <span className="text-xs text-gray-500">+{patient.rtStructures.length - 5} more</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Unprocessed Files - Fallback for orphaned files */}
      {unprocessedFiles.length > 0 && !isUploading && triageSessions.length === 0 && (
        <Card className="border-orange-600 bg-orange-900/20">
          <CardHeader>
            <CardTitle className="text-orange-300 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Orphaned Files Found
            </CardTitle>
            <p className="text-orange-200 text-sm">Files that weren't automatically processed - manual processing required</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {unprocessedFiles.map((file) => (
              <div key={file.sessionId} className="flex items-center justify-between p-3 bg-orange-800/20 rounded-lg">
                <div>
                  <p className="text-white font-medium">{file.fileCount} DICOM files</p>
                  <p className="text-sm text-gray-400">
                    Uploaded {new Date(file.uploadTime).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleProcessUnprocessedFiles(file.sessionId)}
                    disabled={processingFileId === file.sessionId}
                    className="border-green-600 text-green-300 hover:bg-green-600/20 disabled:opacity-50"
                  >
                    {processingFileId === file.sessionId ? 'Processing...' : 'Process'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDeleteUnprocessedFiles(file.sessionId)}
                    className="border-red-600 text-red-300 hover:bg-red-600/20"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Error Display */}
      {error && (
        <Card className="border-red-600 bg-red-900/20">
          <div className="p-4 flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
            <div>
              <h3 className="text-red-300 font-medium">Upload Error</h3>
              <p className="text-red-200 text-sm mt-1">{error}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-300"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </Card>
      )}

      {/* Parse Results - Only show if not already in triage */}
      {parseResult && !triageSessions.some(t => 
        t.parseResult?.data?.length === parseResult.data?.length
      ) && (
        <div className="space-y-6">
          {/* Header Card */}
          <Card className="border-green-600 bg-green-900/20">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <FileCheck className="w-6 h-6 text-green-400" />
                  <div>
                    <h3 className="text-green-300 font-semibold text-lg">Ready to Import</h3>
                    <p className="text-green-200 text-sm">Successfully parsed {parseResult.totalImages || 0} images • Click "Import to Database" below to complete</p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={exportMetadata}
                    className="border-green-600 text-green-300 hover:bg-green-800"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export JSON
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Patient Preview Cards */}
          {parseResult.patientPreviews && parseResult.patientPreviews.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-white font-semibold">Patient Preview</h4>
              {parseResult.patientPreviews.map((patient) => (
                <PatientPreviewCard 
                  key={patient.patientId} 
                  patient={patient} 
                  rtStructures={parseResult.rtstructDetails}
                />
              ))}
            </div>
          )}

          {/* Import Action Card - Glassmorphic Style */}
          <Card className="border-emerald-500/40 bg-gradient-to-br from-emerald-900/30 to-green-900/20 backdrop-blur-xl shadow-2xl shadow-emerald-900/20">
            <div className="p-8 text-center">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-emerald-400/20 blur-xl rounded-full" />
                <CheckCircle className="relative w-16 h-16 text-emerald-400 mx-auto animate-pulse" />
              </div>
              <h4 className="text-white font-bold text-xl mb-3 bg-gradient-to-r from-emerald-300 to-green-300 bg-clip-text text-transparent">
                Ready to Import
              </h4>
              <p className="text-gray-300 mb-6 leading-relaxed">
                {parseResult?.patientPreviews?.length || 0} patient{(parseResult?.patientPreviews?.length || 0) !== 1 ? 's' : ''} analyzed with {parseResult?.data?.length || 0} images. 
                Review the data above and click to import to your database.
              </p>
              <Button
                onClick={handleImportToDatabase}
                disabled={isImporting}
                className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-semibold px-8 py-3 rounded-xl shadow-lg hover:shadow-emerald-500/25 transform hover:scale-105 transition-all duration-200"
                size="lg"
              >
                <Database className="w-5 h-5 mr-2" />
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {importMessage || 'Importing...'}
                  </>
                ) : (
                  'Import to Database'
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
      
      {/* Import Success Summary */}
      {importSuccess && (
        <Card className="border-emerald-500/60 bg-gradient-to-br from-emerald-900/40 to-green-900/30 backdrop-blur-xl shadow-2xl shadow-emerald-900/30">
          <div className="p-8 text-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-emerald-400/30 blur-2xl rounded-full animate-pulse" />
              <CheckCircle className="relative w-20 h-20 text-emerald-400 mx-auto" />
            </div>
            
            <h3 className="text-2xl font-bold text-white mb-2 bg-gradient-to-r from-emerald-300 to-green-300 bg-clip-text text-transparent">
              Import Successful! 🎉
            </h3>
            
            <div className="text-lg text-gray-200 mb-6">
              <p className="mb-2">
                Successfully imported <span className="font-semibold text-emerald-300">{importSuccess.patientCount} patient{importSuccess.patientCount !== 1 ? 's' : ''}</span> 
                {' '}with <span className="font-semibold text-emerald-300">{importSuccess.imageCount} images</span>
              </p>
              <p className="text-sm text-gray-400">
                Completed at {new Date(importSuccess.timestamp).toLocaleTimeString()}
              </p>
            </div>
            
            {/* Patient Summary */}
            {importSuccess.patientPreviews && importSuccess.patientPreviews.length > 0 && (
              <div className="mb-6 p-4 bg-black/30 rounded-lg border border-emerald-500/20">
                <h4 className="text-white font-semibold mb-3">Imported Patients</h4>
                <div className="space-y-2">
                  {importSuccess.patientPreviews.map((patient, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm">
                      <span className="text-gray-300">{patient.patientName || 'Anonymous'}</span>
                      <span className="text-emerald-400 font-medium">
                        {patient.studies?.length || 1} studies • {patient.totalImages || 0} images
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex gap-4 justify-center">
              <Button
                onClick={() => setLocation('/')}
                className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-semibold px-6 py-3 rounded-xl shadow-lg hover:shadow-emerald-500/25 transform hover:scale-105 transition-all duration-200"
                size="lg"
              >
                Go to Patient Manager
              </Button>
              
              <Button
                onClick={() => setImportSuccess(null)}
                variant="outline"
                className="border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/20 px-6 py-3 rounded-xl"
                size="lg"
              >
                Import More Files
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}