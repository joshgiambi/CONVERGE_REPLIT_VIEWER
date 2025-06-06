import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FolderOpen, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { isDICOMFile } from '@/lib/dicom-utils';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface UploadZoneProps {
  onUploadComplete: (data: any) => void;
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [uploadResult, setUploadResult] = useState<any>(null);

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      
      if (files.length === 0) {
        throw new Error('No files selected');
      }

      // Add all files, let server filter DICOM files
      files.forEach((file, index) => {
        formData.append('files', file);
        setCurrentFile(file.name);
        setUploadProgress((index / files.length) * 90); // Reserve 10% for processing
      });

      const response = await apiRequest('POST', '/api/upload', formData);
      return response.json();
    },
    onSuccess: (data) => {
      setUploadProgress(100);
      setUploadResult(data);
      setTimeout(() => {
        onUploadComplete(data);
      }, 1000);
    },
    onError: (error) => {
      console.error('Upload failed:', error);
      setUploadResult({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Upload failed' 
      });
    }
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setUploadProgress(0);
      setUploadResult(null);
      uploadMutation.mutate(acceptedFiles);
    }
  }, [uploadMutation]);

  const handleCreateTestData = async () => {
    try {
      setUploadProgress(0);
      setUploadResult(null);
      setCurrentFile('Creating test data...');
      setUploadProgress(50);
      
      const response = await apiRequest('POST', '/api/create-test-data', {});
      const data = await response.json();
      
      setUploadProgress(100);
      setUploadResult({
        success: true,
        processed: 3,
        errors: 0,
        errorDetails: [],
        studies: [data.study],
        series: data.series
      });
      
      setTimeout(() => {
        onUploadComplete({
          success: true,
          studies: [data.study],
          series: data.series
        });
      }, 1000);
      
    } catch (error) {
      console.error('Error creating test data:', error);
      setUploadResult({ 
        success: false, 
        error: 'Failed to create test data' 
      });
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/dicom': ['.dcm', '.dicom'],
      'application/octet-stream': ['.ima', '.img'],
      'image/*': []
    },
    multiple: true,
    noClick: false,
    noKeyboard: false
  });

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setUploadProgress(0);
      setUploadResult(null);
      uploadMutation.mutate(files);
    }
  };

  const isUploading = uploadMutation.isPending;
  const hasResult = uploadResult !== null;

  return (
    <Card className="p-8">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-all duration-500 cursor-pointer relative overflow-hidden
          ${isDragActive 
            ? 'border-gradient-primary bg-gradient-subtle scale-102 animate-glow' 
            : 'border-dicom-blue/50 hover:border-gradient-primary hover:bg-gradient-subtle hover:shadow-lg hover:shadow-dicom-yellow/20'
          }
          ${isUploading ? 'pointer-events-none' : 'hover:-translate-y-1'}
        `}
      >
        <input {...getInputProps()} />
        
        <div className="flex flex-col items-center space-y-4">
          <div className="w-20 h-20 bg-gradient-primary rounded-full flex items-center justify-center animate-float">
            <FolderOpen className="w-10 h-10 text-white" />
          </div>
          
          <div>
            <h3 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent mb-3">
              Upload DICOM Studies
            </h3>
            <p className="text-gray-300 mb-4 text-lg">
              Drop entire folders containing DICOM files or browse to select
            </p>
            <p className="text-sm text-gray-400">
              Supports: CT, MRI, PET-CT • Automatically organizes by study and series
            </p>
          </div>
          
          {!isUploading && !hasResult && (
            <div className="flex gap-4">
              <div className="relative">
                <input
                  type="file"
                  webkitdirectory=""
                  multiple
                  onChange={handleFolderSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  id="folder-input"
                />
                <label
                  htmlFor="folder-input"
                  className="btn-animated text-black font-semibold px-6 py-3 rounded-lg cursor-pointer inline-flex items-center"
                >
                  <FolderOpen className="w-5 h-5 mr-2" />
                  Select DICOM Folder
                </label>
              </div>
              <Button 
                variant="outline"
                className="border-2 border-dicom-blue text-dicom-blue hover:bg-gradient-primary hover:text-white hover:border-transparent transition-all duration-300 hover:scale-105 px-6 py-3 rounded-lg font-semibold"
                onClick={handleCreateTestData}
              >
                Load Demo Data
              </Button>
            </div>
          )}
        </div>
        
        {/* Upload Progress */}
        {isUploading && (
          <div className="mt-6 space-y-4 animate-in slide-in-from-bottom-2 duration-300">
            <div className="bg-dicom-dark rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Processing DICOM files...</span>
                <span className="text-sm text-dicom-yellow">{Math.round(uploadProgress)}%</span>
              </div>
              <Progress value={uploadProgress} className="mb-2" />
              <div className="flex items-center text-xs text-gray-400">
                <div className="w-3 h-3 border border-dicom-yellow border-t-transparent rounded-full animate-spin mr-2" />
                <span>Analyzing {currentFile}</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Upload Result */}
        {hasResult && (
          <div className="mt-6 animate-in slide-in-from-bottom-2 duration-300">
            <div className={`rounded-lg p-4 ${uploadResult.success ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
              <div className="flex items-center mb-2">
                {uploadResult.success ? (
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                )}
                <span className="font-medium">
                  {uploadResult.success ? 'Upload Successful' : 'Upload Failed'}
                </span>
              </div>
              
              {uploadResult.success && (
                <div className="text-sm text-gray-400">
                  <p>Processed {uploadResult.processed} files</p>
                  {uploadResult.errors > 0 && (
                    <p className="text-yellow-500">
                      {uploadResult.errors} files had errors
                    </p>
                  )}
                </div>
              )}
              
              {!uploadResult.success && (
                <p className="text-sm text-red-400">
                  {uploadResult.error}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
