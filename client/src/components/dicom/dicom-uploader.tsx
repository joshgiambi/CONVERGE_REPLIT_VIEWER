import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Upload, FileCheck, AlertCircle, X, Download, Database } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

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

interface ParseResult {
  success: boolean;
  data: DICOMMetadata[];
  rtstructDetails: RTStructDetails;
  totalFiles: number;
  message: string;
}

export function DICOMUploader() {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    setIsUploading(true);
    setError(null);
    setParseResult(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      acceptedFiles.forEach(file => {
        formData.append('files', file);
      });

      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch('/api/parse-dicom', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to parse DICOM files');
      }

      const result: ParseResult = await response.json();
      setParseResult(result);

    } catch (error) {
      console.error('Upload error:', error);
      setError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  }, []);

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
              <p className="text-lg text-white">Parsing DICOM files...</p>
              <Progress value={uploadProgress} className="w-full max-w-md mx-auto" />
              <p className="text-sm text-gray-400">{uploadProgress}% complete</p>
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
        <Card className="border-green-600 bg-green-900/20">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <FileCheck className="w-6 h-6 text-green-400" />
                <div>
                  <h3 className="text-green-300 font-semibold text-lg">Parsing Complete</h3>
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
                <Button
                  size="sm"
                  onClick={handleImportToDatabase}
                  disabled={isImporting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Database className="w-4 h-4 mr-2" />
                  {isImporting ? 'Importing...' : 'Import to Database'}
                </Button>
              </div>
            </div>

            {/* Metadata Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <div className="bg-black/40 p-4 rounded-lg">
                <h4 className="text-white font-medium mb-2">Files Parsed</h4>
                <p className="text-2xl font-bold text-green-400">{parseResult.totalFiles}</p>
              </div>
              
              <div className="bg-black/40 p-4 rounded-lg">
                <h4 className="text-white font-medium mb-2">Modalities</h4>
                <div className="flex flex-wrap gap-1">
                  {Array.from(new Set(parseResult.data.map(d => d.modality).filter(Boolean))).map(modality => (
                    <Badge key={modality} variant="outline" className={`${getModalityColor(modality)} text-white border-transparent`}>
                      {modality}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="bg-black/40 p-4 rounded-lg">
                <h4 className="text-white font-medium mb-2">Patients</h4>
                <p className="text-2xl font-bold text-green-400">
                  {Array.from(new Set(parseResult.data.map(d => d.patientID).filter(Boolean))).length}
                </p>
              </div>
            </div>

            {/* RT Structure Sets */}
            {Object.keys(parseResult.rtstructDetails).length > 0 && (
              <div className="mb-6">
                <h4 className="text-white font-semibold mb-3">RT Structure Sets</h4>
                <div className="space-y-3">
                  {Object.entries(parseResult.rtstructDetails).map(([filename, details]) => (
                    <div key={filename} className="bg-black/40 p-4 rounded-lg">
                      <div className="flex justify-between items-start mb-2">
                        <h5 className="text-green-300 font-medium">{filename}</h5>
                        <Badge variant="outline" className="bg-purple-500 text-white border-transparent">
                          RTSTRUCT
                        </Badge>
                      </div>
                      <p className="text-gray-400 text-sm mb-3">
                        Structure Set Date: {details.structureSetDate || 'Unknown'}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {details.structures.map(([name, color], index) => (
                          <div key={index} className="flex items-center space-x-3">
                            <div 
                              className="w-4 h-4 rounded border border-gray-500"
                              style={{ 
                                backgroundColor: color ? `rgb(${color[0]}, ${color[1]}, ${color[2]})` : '#666' 
                              }}
                            />
                            <span className="text-white text-sm">{name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Files */}
            {parseResult.data.some(d => d.error) && (
              <div>
                <h4 className="text-red-300 font-semibold mb-3">Files with Errors</h4>
                <div className="space-y-2">
                  {parseResult.data.filter(d => d.error).map((item, index) => (
                    <div key={index} className="bg-red-900/20 p-3 rounded border border-red-600">
                      <div className="flex items-start justify-between">
                        <span className="text-red-200 font-medium">{item.filename}</span>
                        <Badge variant="outline" className="bg-red-500 text-white border-transparent">
                          ERROR
                        </Badge>
                      </div>
                      <p className="text-red-300 text-sm mt-1">{item.error}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}