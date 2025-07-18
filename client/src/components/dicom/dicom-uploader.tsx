import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Upload, FileCheck, AlertCircle, X, Download, Database, CheckCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { PatientPreviewCard } from './patient-preview-card';
import { useLocation } from 'wouter';

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

export function DICOMUploader() {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parseSession, setParseSession] = useState<ParseSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  // Poll for session status
  const pollSessionStatus = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/parse-dicom-session/${sessionId}`);
      if (!response.ok) {
        throw new Error('Failed to check session status');
      }
      
      const session: ParseSession = await response.json();
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
      } else if (session.status === 'error') {
        setError(session.error || 'Parsing failed');
        setIsUploading(false);
        localStorage.removeItem('currentParseSessionId');
      } else {
        // Continue polling
        setTimeout(() => pollSessionStatus(sessionId), 500);
      }
    } catch (error) {
      console.error('Error polling session:', error);
      setError('Failed to check parsing status');
      setIsUploading(false);
      localStorage.removeItem('currentParseSessionId');
    }
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    const sessionId = localStorage.getItem('currentParseSessionId');
    if (sessionId) {
      setSavedSessionId(sessionId);
      setIsUploading(true);
      pollSessionStatus(sessionId);
    }
  }, [pollSessionStatus]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    setIsUploading(true);
    setError(null);
    setParseResult(null);
    setParseSession(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      acceptedFiles.forEach(file => {
        formData.append('files', file);
      });

      // Start parsing session
      const response = await fetch('/api/parse-dicom-session', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start parsing session');
      }

      const { sessionId } = await response.json();
      
      // Save session ID to localStorage
      localStorage.setItem('currentParseSessionId', sessionId);
      setSavedSessionId(sessionId);
      
      // Start polling for progress
      pollSessionStatus(sessionId);

    } catch (error) {
      console.error('Upload error:', error);
      setError(error instanceof Error ? error.message : 'Upload failed');
      setIsUploading(false);
    }
  }, [pollSessionStatus]);

  const handleImportToDatabase = async () => {
    if (!parseResult) return;

    setIsImporting(true);
    setError(null);

    try {
      await apiRequest('/api/import-dicom-metadata', {
        method: 'POST',
        body: {
          data: parseResult.data,
          rtstructDetails: parseResult.rtstructDetails
        }
      });

      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/patients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/studies'] });

      setParseResult(null); // Clear results after successful import
      
      // Navigate to patient manager
      setTimeout(() => {
        setLocation('/patients');
      }, 500);
      
    } catch (error) {
      console.error('Import error:', error);
      setError(error instanceof Error ? error.message : 'Import failed');
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/dicom': ['.dcm'],
      'application/octet-stream': ['.dcm']
    },
    disabled: isUploading,
    multiple: true
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
                Supports .dcm files, ZIP archives, and folders
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
                    <h3 className="text-green-300 font-semibold text-lg">Review Import Data</h3>
                    <p className="text-green-200 text-sm">{parseResult.message}</p>
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