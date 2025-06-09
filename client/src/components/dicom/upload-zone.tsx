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
      if (files.length === 0) {
        throw new Error('No files selected');
      }

      console.log(`Starting upload of ${files.length} files`);
      
      // Process files in batches to avoid overwhelming the server
      const batchSize = 20;
      const batches = [];
      for (let i = 0; i < files.length; i += batchSize) {
        batches.push(files.slice(i, i + batchSize));
      }

      let totalProcessed = 0;
      let allStudies: any[] = [];
      let allSeries: any[] = [];

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const formData = new FormData();
        
        batch.forEach(file => {
          console.log(`Adding file to batch: ${file.name}, size: ${file.size}`);
          formData.append('files', file);
        });

        setCurrentFile(`Batch ${batchIndex + 1}/${batches.length} (${batch.length} files)`);
        setUploadProgress((batchIndex / batches.length) * 90);

        const response = await apiRequest('POST', '/api/upload', formData);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Batch ${batchIndex + 1} failed: ${response.status} - ${errorText}`);
        }
        
        const batchResult = await response.json();
        totalProcessed += batchResult.processed || 0;
        
        if (batchResult.studies) {
          allStudies.push(...batchResult.studies);
        }
        if (batchResult.series) {
          allSeries.push(...batchResult.series);
        }
      }

      console.log(`Upload completed: ${totalProcessed} files processed across ${batches.length} batches`);
      
      return {
        success: true,
        processed: totalProcessed,
        errors: 0,
        studies: allStudies,
        series: allSeries,
        totalFiles: files.length,
        batches: batches.length
      };
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
    noClick: true, // Disable dropzone click to prevent conflicts
    noKeyboard: false
  });

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) {
      console.error('No files in file list');
      return;
    }
    
    const files = Array.from(fileList);
    console.log('Files selected:', files.length);
    console.log('First few files:', files.slice(0, 3).map(f => ({ name: f.name, size: f.size, type: f.type })));
    
    if (files.length > 0) {
      setUploadProgress(0);
      setUploadResult(null);
      uploadMutation.mutate(files);
    }
    // Reset the input
    e.target.value = '';
  };

  const isUploading = uploadMutation.isPending;
  const hasResult = uploadResult !== null;

  return (
    <Card className="p-8">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 cursor-pointer
          ${isDragActive 
            ? 'border-dicom-purple bg-dicom-purple/10' 
            : 'border-dicom-indigo/50 hover:border-dicom-purple hover:bg-dicom-purple/5'
          }
          ${isUploading ? 'pointer-events-none opacity-50' : ''}
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
            <div className="flex gap-4 items-center">
              <input
                type="file"
                {...({ webkitdirectory: "" } as any)}
                multiple
                onChange={handleFolderSelect}
                style={{ display: 'none' }}
                id="folder-input"
              />
              <div
                className="bg-gradient-primary text-white font-semibold px-6 py-3 rounded-lg inline-flex items-center transition-all duration-300 hover:scale-105 cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const input = document.getElementById('folder-input') as HTMLInputElement;
                  if (input) {
                    input.click();
                  }
                }}
              >
                <FolderOpen className="w-5 h-5 mr-2" />
                Select DICOM Folder
              </div>
              <div 
                className="border-2 border-dicom-indigo text-dicom-indigo hover:bg-gradient-primary hover:text-white hover:border-transparent transition-all duration-300 hover:scale-105 px-6 py-3 rounded-lg font-semibold cursor-pointer inline-flex items-center"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCreateTestData();
                }}
              >
                Load Demo Data
              </div>
            </div>
          )}
        </div>
        
        {/* Upload Progress */}
        {isUploading && (
          <div className="mt-6 space-y-4 animate-in slide-in-from-bottom-2 duration-300">
            <div className="bg-dicom-dark rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Processing DICOM files...</span>
                <span className="text-sm text-dicom-purple">{Math.round(uploadProgress)}%</span>
              </div>
              <Progress value={uploadProgress} className="mb-2" />
              <div className="flex items-center text-xs text-gray-400">
                <div className="w-3 h-3 border border-dicom-purple border-t-transparent rounded-full animate-spin mr-2" />
                <span>Analyzing {currentFile}</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Upload Result */}
        {hasResult && (
          <div className="mt-6 animate-in slide-in-from-bottom-2 duration-300">
            <div className={`rounded-lg p-4 ${uploadResult.success ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center">
                  {uploadResult.success ? (
                    <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                  )}
                  <span className="font-medium">
                    {uploadResult.success ? 'Upload Successful' : 'Upload Failed'}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setUploadResult(null);
                    setUploadProgress(0);
                    setCurrentFile('');
                  }}
                  className="text-gray-400 hover:text-white transition-colors duration-200 p-1 rounded hover:bg-gray-600"
                  title="Clear message"
                >
                  ✕
                </button>
              </div>
              
              {uploadResult.success && (
                <div className="text-sm text-gray-400">
                  <p>Processed {uploadResult.processed} files{uploadResult.totalFiles ? ` of ${uploadResult.totalFiles}` : ''}</p>
                  {uploadResult.batches && (
                    <p>Uploaded in {uploadResult.batches} batches</p>
                  )}
                  {uploadResult.studies && uploadResult.studies.length > 0 && (
                    <p>Created {uploadResult.studies.length} studies with {uploadResult.series?.length || 0} series</p>
                  )}
                  {uploadResult.errors > 0 && (
                    <p className="text-yellow-500">
                      {uploadResult.errors} files had errors
                    </p>
                  )}
                </div>
              )}
              
              {!uploadResult.success && (
                <div className="text-sm text-red-400">
                  <p>{uploadResult.error}</p>
                  <p className="mt-2 text-xs text-gray-500">Click the × to try again</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
