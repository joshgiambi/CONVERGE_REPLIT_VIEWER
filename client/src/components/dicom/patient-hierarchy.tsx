import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  User, 
  FileText, 
  Database, 
  Image as ImageIcon,
  ChevronDown, 
  ChevronRight,
  Eye,
  Calendar,
  Activity
} from 'lucide-react';

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

interface Series {
  id: number;
  seriesInstanceUID: string;
  studyId: number;
  seriesDescription: string;
  modality: string;
  seriesNumber: number;
  numberOfImages: number;
  createdAt: string;
}

interface DICOMImage {
  id: number;
  sopInstanceUID: string;
  seriesId: number;
  instanceNumber: number;
  fileName: string;
  filePath: string;
  imagePosition?: number[];
  createdAt: string;
}

interface PatientHierarchyProps {
  patients: Patient[];
  studies: Study[];
  onViewSeries: (studyId: number, seriesId: number) => void;
}

export function PatientHierarchy({ patients, studies, onViewSeries }: PatientHierarchyProps) {
  const [expandedPatients, setExpandedPatients] = useState<Set<number>>(new Set());
  const [expandedStudies, setExpandedStudies] = useState<Set<number>>(new Set());
  const [expandedSeries, setExpandedSeries] = useState<Set<number>>(new Set());

  // Fetch all series
  const { data: allSeries = [] } = useQuery<Series[]>({
    queryKey: ['/api/series'],
  });

  const togglePatient = (patientId: number) => {
    setExpandedPatients(prev => {
      const next = new Set(prev);
      if (next.has(patientId)) {
        next.delete(patientId);
      } else {
        next.add(patientId);
      }
      return next;
    });
  };

  const toggleStudy = (studyId: number) => {
    setExpandedStudies(prev => {
      const next = new Set(prev);
      if (next.has(studyId)) {
        next.delete(studyId);
      } else {
        next.add(studyId);
      }
      return next;
    });
  };

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

  const formatDate = (dateString: string) => {
    if (!dateString) return "Unknown";
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const getModalityColor = (modality: string) => {
    switch (modality) {
      case 'CT': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'MR': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'RTSTRUCT': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'RTPLAN': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'RTDOSE': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  return (
    <div className="space-y-4">
      {patients.map((patient) => {
        const patientStudies = studies.filter(study => study.patientID === patient.patientID);
        const isPatientExpanded = expandedPatients.has(patient.id);
        
        return (
          <Card key={patient.id} className="overflow-hidden">
            <Collapsible>
              <CollapsibleTrigger asChild>
                <CardHeader 
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  onClick={() => togglePatient(patient.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isPatientExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <User className="h-5 w-5 text-blue-600" />
                      <div>
                        <CardTitle className="text-lg">
                          {patient.patientName || "Unknown Patient"}
                        </CardTitle>
                        <div className="text-sm text-gray-500">
                          ID: {patient.patientID}
                          {patient.patientSex && ` • ${patient.patientSex}`}
                          {patient.patientAge && ` • Age ${patient.patientAge}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {patientStudies.length} studies
                      </Badge>
                      <Badge variant="outline">
                        {patientStudies.reduce((sum, study) => sum + study.numberOfImages, 0)} images
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <CardContent className="pt-0">
                  {patientStudies.length === 0 ? (
                    <div className="text-center py-4 text-gray-500">
                      No studies found for this patient
                    </div>
                  ) : (
                    <div className="space-y-3 ml-6">
                      {patientStudies.map((study) => {
                        const studySeries = allSeries.filter(series => series.studyId === study.id);
                        const isStudyExpanded = expandedStudies.has(study.id);
                        
                        return (
                          <Card key={study.id} className="border-l-4 border-l-blue-500">
                            <Collapsible>
                              <CollapsibleTrigger asChild>
                                <CardHeader 
                                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors py-3"
                                  onClick={() => toggleStudy(study.id)}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      {isStudyExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                      <FileText className="h-4 w-4 text-green-600" />
                                      <div>
                                        <div className="font-medium">
                                          {study.studyDescription || "Unknown Study"}
                                        </div>
                                        <div className="text-sm text-gray-500 flex items-center gap-2">
                                          <Calendar className="h-3 w-3" />
                                          {formatDate(study.studyDate)}
                                          {study.accessionNumber && ` • Acc: ${study.accessionNumber}`}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge className={getModalityColor(study.modality)}>
                                        {study.modality}
                                      </Badge>
                                      <Badge variant="outline">
                                        {study.numberOfSeries} series
                                      </Badge>
                                      <Badge variant="outline">
                                        {study.numberOfImages} images
                                      </Badge>
                                    </div>
                                  </div>
                                </CardHeader>
                              </CollapsibleTrigger>

                              <CollapsibleContent>
                                <CardContent className="pt-0">
                                  {studySeries.length === 0 ? (
                                    <div className="text-center py-3 text-gray-500">
                                      No series found for this study
                                    </div>
                                  ) : (
                                    <div className="space-y-2 ml-6">
                                      {studySeries.map((series) => {
                                        const isSeriesExpanded = expandedSeries.has(series.id);
                                        
                                        return (
                                          <Card key={series.id} className="border-l-4 border-l-green-500">
                                            <CollapsibleTrigger asChild>
                                              <CardHeader 
                                                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors py-2"
                                                onClick={() => toggleSeries(series.id)}
                                              >
                                                <div className="flex items-center justify-between">
                                                  <div className="flex items-center gap-3">
                                                    {isSeriesExpanded ? (
                                                      <ChevronDown className="h-3 w-3" />
                                                    ) : (
                                                      <ChevronRight className="h-3 w-3" />
                                                    )}
                                                    <Database className="h-4 w-4 text-purple-600" />
                                                    <div>
                                                      <div className="font-medium text-sm">
                                                        Series {series.seriesNumber}: {series.seriesDescription || "Unknown Series"}
                                                      </div>
                                                      <div className="text-xs text-gray-500">
                                                        {series.seriesInstanceUID.substring(0, 40)}...
                                                      </div>
                                                    </div>
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    <Badge className={getModalityColor(series.modality)} variant="outline">
                                                      {series.modality}
                                                    </Badge>
                                                    <Badge variant="outline" className="text-xs">
                                                      {series.numberOfImages} images
                                                    </Badge>
                                                    <Button
                                                      size="sm"
                                                      variant="outline"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        onViewSeries(study.id, series.id);
                                                      }}
                                                    >
                                                      <Eye className="h-3 w-3 mr-1" />
                                                      View
                                                    </Button>
                                                  </div>
                                                </div>
                                              </CardHeader>
                                            </CollapsibleTrigger>

                                            <CollapsibleContent>
                                              <CardContent className="pt-0">
                                                <SeriesImagesList seriesId={series.id} />
                                              </CardContent>
                                            </CollapsibleContent>
                                          </Card>
                                        );
                                      })}
                                    </div>
                                  )}
                                </CardContent>
                              </CollapsibleContent>
                            </Collapsible>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}
    </div>
  );
}

function SeriesImagesList({ seriesId }: { seriesId: number }) {
  const { data: images = [], isLoading } = useQuery<DICOMImage[]>({
    queryKey: ['/api/series', seriesId, 'images'],
    enabled: !!seriesId,
  });

  if (isLoading) {
    return <div className="text-center py-2 text-sm text-gray-500">Loading images...</div>;
  }

  if (images.length === 0) {
    return <div className="text-center py-2 text-sm text-gray-500">No images found</div>;
  }

  return (
    <div className="ml-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {images.slice(0, 12).map((image) => (
          <div 
            key={image.id}
            className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs"
          >
            <ImageIcon className="h-3 w-3 text-gray-600" />
            <div className="flex-1 truncate">
              <div className="font-medium">Instance {image.instanceNumber}</div>
              <div className="text-gray-500 truncate">{image.fileName}</div>
            </div>
          </div>
        ))}
      </div>
      {images.length > 12 && (
        <div className="text-center mt-2 text-xs text-gray-500">
          ... and {images.length - 12} more images
        </div>
      )}
    </div>
  );
}