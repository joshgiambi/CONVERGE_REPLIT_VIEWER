import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Upload, 
  FileCheck, 
  AlertCircle, 
  CheckCircle, 
  Clock,
  FolderOpen,
  ArrowRight,
  Loader2,
  FileX
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

interface UploadState {
  status: 'idle' | 'uploading' | 'processing' | 'complete' | 'error';
  progress: number;
  message: string;
  filesCount: number;
  processedCount: number;
  sessionId?: string;
  patientInfo?: {
    patientId: string;
    patientName: string;
    studyCount: number;
  };
}

export function SimplifiedUploader() {
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle',
    progress: 0,
    message: '',
    filesCount: 0,
    processedCount: 0
  });
  
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Poll for session status
  const pollSessionStatus = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/parse-dicom-session/${sessionId}`);
      if (!response.ok) throw new Error('Failed to check session status');
      
      const session = await response.json();
      
      // Update progress
      if (session.total > 0) {
        setUploadState(prev => ({
          ...prev,
          progress: Math.round((session.progress / session.total) * 100),
          processedCount: session.progress,
          filesCount: session.total,
          message: `Processing file ${session.progress} of ${session.total}...`
        }));
      }
      
      // Handle completion
      if (session.status === 'complete' && session.result) {
        setUploadState(prev => ({
          ...prev,
          status: 'complete',
          progress: 100,
          message: 'Processing complete! Ready to import.',
          patientInfo: session.result.patientPreviews?.[0] ? {
            patientId: session.result.patientPreviews[0].patientId,
            patientName: session.result.patientPreviews[0].patientName,
            studyCount: session.result.patientPreviews[0].studies.length
          } : undefined
        }));
        
        // Auto-import after a short delay
        setTimeout(() => handleAutoImport(sessionId), 1000);
      } else if (session.status === 'error') {
        setUploadState(prev => ({
          ...prev,
          status: 'error',
          message: session.error || 'Processing failed'
        }));
      } else {
        // Continue polling
        setTimeout(() => pollSessionStatus(sessionId), 500);
      }
    } catch (error) {
      console.error('Error polling session:', error);
      setUploadState(prev => ({
        ...prev,
        status: 'error',
        message: 'Failed to check processing status'
      }));
    }
  };

  // Auto-import the processed files
  const handleAutoImport = async (sessionId: string) => {
    try {
      setUploadState(prev => ({
        ...prev,
        message: 'Importing data into database...'
      }));
      
      const response = await apiRequest('POST', '/api/import-triage-session', { 
        sessionId,
        autoImport: true 
      });
      
      if (response.ok) {
        const result = await response.json();
        
        toast({
          title: "Import Successful",
          description: `Imported ${result.importedCount} files successfully`,
        });
        
        // Refresh patient list
        queryClient.invalidateQueries({ queryKey: ['/api/patients'] });
        
        // Navigate to patient view after a short delay
        setTimeout(() => {
          if (result.patientId) {
            setLocation(`/patients/${result.patientId}/studies`);
          } else {
            setLocation('/');
          }
        }, 1500);
      }
    } catch (error) {
      console.error('Import error:', error);
      setUploadState(prev => ({
        ...prev,
        status: 'error',
        message: 'Failed to import data. Please try manually.'
      }));
    }
  };

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    // Reset state
    setUploadState({
      status: 'uploading',
      progress: 0,
      message: `Uploading ${acceptedFiles.length} files...`,
      filesCount: acceptedFiles.length,
      processedCount: 0
    });

    try {
      const formData = new FormData();
      acceptedFiles.forEach(file => {
        formData.append('files', file);
      });
      
      // Upload files
      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Upload failed');
      }

      const uploadResult = await uploadResponse.json();
      
      setUploadState(prev => ({
        ...prev,
        status: 'processing',
        message: 'Files uploaded. Starting processing...',
        sessionId: uploadResult.sessionId
      }));
      
      // Start parsing
      const parseResponse = await apiRequest('POST', '/api/parse-dicom-session', {
        sessionId: uploadResult.sessionId,
      });

      if (parseResponse.ok) {
        const { sessionId } = await parseResponse.json();
        
        // Start polling for status
        pollSessionStatus(sessionId);
      } else {
        throw new Error('Failed to start processing');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadState(prev => ({
        ...prev,
        status: 'error',
        message: 'Upload failed. Please try again.'
      }));
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/dicom': ['.dcm', '.DCM'],
      'application/zip': ['.zip'],
    },
    multiple: true,
  });

  // Reset handler
  const handleReset = () => {
    setUploadState({
      status: 'idle',
      progress: 0,
      message: '',
      filesCount: 0,
      processedCount: 0
    });
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          DICOM File Upload
        </CardTitle>
        <CardDescription>
          Upload DICOM files or ZIP archives to import medical imaging data
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Upload Status Display */}
        {uploadState.status !== 'idle' && (
          <div className="space-y-3">
            {/* Status Badge */}
            <div className="flex items-center justify-between">
              <Badge 
                variant={
                  uploadState.status === 'complete' ? 'default' :
                  uploadState.status === 'error' ? 'destructive' :
                  'secondary'
                }
                className="text-sm"
              >
                {uploadState.status === 'uploading' && (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Uploading
                  </>
                )}
                {uploadState.status === 'processing' && (
                  <>
                    <Clock className="h-3 w-3 mr-1" />
                    Processing
                  </>
                )}
                {uploadState.status === 'complete' && (
                  <>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Complete
                  </>
                )}
                {uploadState.status === 'error' && (
                  <>
                    <FileX className="h-3 w-3 mr-1" />
                    Error
                  </>
                )}
              </Badge>
              
              {uploadState.filesCount > 0 && (
                <span className="text-sm text-muted-foreground">
                  {uploadState.processedCount} / {uploadState.filesCount} files
                </span>
              )}
            </div>

            {/* Progress Bar */}
            {uploadState.status !== 'error' && (
              <Progress value={uploadState.progress} className="h-2" />
            )}

            {/* Status Message */}
            <Alert variant={uploadState.status === 'error' ? 'destructive' : 'default'}>
              <AlertDescription className="flex items-center gap-2">
                {uploadState.status === 'error' && <AlertCircle className="h-4 w-4" />}
                {uploadState.message}
              </AlertDescription>
            </Alert>

            {/* Patient Info (when complete) */}
            {uploadState.status === 'complete' && uploadState.patientInfo && (
              <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-green-900 dark:text-green-100">
                      Ready to view
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Patient: {uploadState.patientInfo.patientName} ({uploadState.patientInfo.patientId})
                    </p>
                    <p className="text-sm text-green-600 dark:text-green-400">
                      {uploadState.patientInfo.studyCount} study(s) imported
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-green-600 dark:text-green-400 animate-pulse" />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {uploadState.status === 'error' && (
              <Button onClick={handleReset} variant="outline" className="w-full">
                Try Again
              </Button>
            )}
          </div>
        )}

        {/* Drop Zone (only show when idle or error) */}
        {(uploadState.status === 'idle' || uploadState.status === 'error') && (
          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
              transition-all duration-200 ease-in-out
              ${isDragActive 
                ? 'border-primary bg-primary/5 scale-[1.02]' 
                : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-accent/5'
              }
            `}
          >
            <input {...getInputProps()} />
            
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 rounded-full bg-primary/10">
                <FolderOpen className="h-8 w-8 text-primary" />
              </div>
              
              <div>
                <p className="text-lg font-medium">
                  {isDragActive ? 'Drop files here' : 'Drag & drop DICOM files'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to select files from your computer
                </p>
              </div>
              
              <div className="flex gap-2 mt-2">
                <Badge variant="outline">DICOM (.dcm)</Badge>
                <Badge variant="outline">ZIP archives</Badge>
              </div>
            </div>
          </div>
        )}

        {/* Help Text */}
        {uploadState.status === 'idle' && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Tips:</strong> You can upload multiple DICOM files at once or a ZIP archive containing your imaging study. 
              The system will automatically organize files by patient and study.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}