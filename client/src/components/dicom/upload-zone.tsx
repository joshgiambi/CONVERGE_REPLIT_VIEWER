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
      
      // Filter DICOM files
      const dicomFiles = files.filter(isDICOMFile);
      
      if (dicomFiles.length === 0) {
        throw new Error('No valid DICOM files found');
      }

      dicomFiles.forEach((file, index) => {
        formData.append('files', file);
        setCurrentFile(file.name);
        setUploadProgress((index / dicomFiles.length) * 90); // Reserve 10% for processing
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/dicom': ['.dcm', '.dicom'],
      'application/octet-stream': ['.ima', '.img'],
      '*': [] // Allow files without extensions
    },
    multiple: true
  });

  const isUploading = uploadMutation.isPending;
  const hasResult = uploadResult !== null;

  return (
    <Card className="p-8">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 cursor-pointer
          ${isDragActive 
            ? 'border-dicom-yellow bg-dicom-yellow/10 scale-102' 
            : 'border-dicom-yellow/50 hover:border-dicom-yellow hover:bg-dicom-yellow/5'
          }
          ${isUploading ? 'pointer-events-none' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 bg-dicom-yellow/20 rounded-full flex items-center justify-center">
            <FolderOpen className="w-8 h-8 text-dicom-yellow" />
          </div>
          
          <div>
            <h3 className="text-xl font-semibold text-dicom-yellow mb-2">
              Upload DICOM Studies
            </h3>
            <p className="text-gray-400 mb-4">
              Drop folders containing DICOM files or click to browse
            </p>
            <p className="text-sm text-gray-500">
              Supports: CT, MRI, PET-CT • Auto-filters non-DICOM files
            </p>
          </div>
          
          {!isUploading && !hasResult && (
            <Button className="bg-dicom-yellow text-black hover:bg-dicom-yellow/90 transition-all duration-200 hover:scale-105">
              <Upload className="w-4 h-4 mr-2" />
              Browse Folders
            </Button>
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
