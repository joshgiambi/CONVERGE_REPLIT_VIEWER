import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Upload, FileCheck, AlertCircle, X, Download, Database, CheckCircle } from 'lucide-react';
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

export function DICOMUploader() {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseSession, setParseSession] = useState<ParseSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [unprocessedFiles, setUnprocessedFiles] = useState<UnprocessedFile[]>([]);
  const [processingFileId, setProcessingFileId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

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
      
      // Update progress
      if (session.total > 0) {
        setUploadProgress(Math.round((session.progress / session.total) * 100));
      }
      
      // If complete, set the result
      if (session.status === 'complete' && session.result) {
        setParseResult(session.result);
        setIsUploading(false);
        localStorage.removeItem('currentParseSessionId');
        localStorage.removeItem('uploadActive');
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
    
    // Check for unprocessed files immediately
    checkUnprocessedFiles();
    
    // Poll for unprocessed files every 3 seconds
    const interval = setInterval(checkUnprocessedFiles, 3000);
    
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

    try {
      // Show toast notification for import start
      toast({
        title: "Importing DICOM data",
        description: "Processing patient data and saving to database...",
      });

      const response = await apiRequest('POST', '/api/import-dicom-metadata', {
        data: parseResult.data,
        rtstructDetails: parseResult.rtstructDetails
      });

      // Show success toast
      toast({
        title: "Import successful",
        description: `Successfully imported ${parseResult.patientPreviews?.length || 0} patients with their studies and series.`,
      });

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

      setParseResult(null); // Clear results after successful import
      
      // Navigate to patient manager
      setTimeout(() => {
        setLocation('/patients');
      }, 1000);
      
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
      {/* Unprocessed Files */}
      {unprocessedFiles.length > 0 && !isUploading && (
        <Card className="border-orange-600 bg-orange-900/20">
          <CardHeader>
            <CardTitle className="text-orange-300 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Unprocessed Files Found
            </CardTitle>
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

      {/* Upload Area */}
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
            <div className="space-y-4">
              <p className="text-lg text-white">
                {parseSession?.currentFile ? 'Processing DICOM files...' : 'Uploading files...'}
              </p>
              <Progress value={uploadProgress} className="w-full max-w-md mx-auto" />
              {parseSession?.currentFile ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-400">
                    File {parseSession.progress} of {parseSession.total} ({uploadProgress}%)
                  </p>
                  <p className="text-xs text-gray-500 truncate max-w-md mx-auto">
                    {parseSession.currentFile}
                  </p>
                  <p className="text-xs text-gray-500 italic">
                    You can navigate away - parsing continues in background
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-400">{uploadProgress}% complete</p>
              )}
            </div>
          ) : (
            <div>
              <p className="text-lg text-white mb-2">
                {isDragActive ? 'Drop DICOM files here' : 'Drag & drop DICOM files here'}
              </p>
              <p className="text-sm text-gray-400 mb-4">
                Supports .dcm files, ZIP archives, and folders • Up to 5000 files per batch
              </p>
              <p className="text-xs text-gray-600">
                For large datasets (&gt;500 files), ZIP format recommended for reliable upload
              </p>
              <p className="text-xs text-orange-400 mt-2">
                Browser file pickers may limit selection to 500-1000 files
              </p>
              <Button variant="outline" className="border-indigo-600 text-indigo-300">
                Or click to browse files
              </Button>
            </div>
          )}
        </div>
      </Card>

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

      {/* Parse Results */}
      {parseResult && (
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

          {/* Import Action Card */}
          <Card className="border-blue-600 bg-blue-900/20">
            <div className="p-6 text-center">
              <CheckCircle className="w-12 h-12 text-blue-400 mx-auto mb-4" />
              <h4 className="text-white font-semibold mb-2">Ready to Import</h4>
              <p className="text-gray-400 mb-4">
                Review the patient data above. Click import to add to your database.
              </p>
              <Button
                onClick={handleImportToDatabase}
                disabled={isImporting}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Database className="w-4 h-4 mr-2" />
                {isImporting ? 'Importing...' : 'Import to Database'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}