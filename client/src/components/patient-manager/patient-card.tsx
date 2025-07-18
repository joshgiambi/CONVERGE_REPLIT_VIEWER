import React, { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, FileStack, Brain, Eye, ChevronDown, ChevronUp, Layers, GitBranch, Loader2, Edit, Tag } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'wouter';
import { MetadataEditDialog } from './metadata-edit-dialog';

interface PatientCardProps {
  patient: any;
  studies: any[];
  series: any[];
}

export function PatientCard({ patient, studies, series }: PatientCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [rtStructures, setRtStructures] = useState<{ [key: number]: any[] }>({});
  const [loadingStructures, setLoadingStructures] = useState<{ [key: number]: boolean }>({});
  const [registrationInfo, setRegistrationInfo] = useState<any>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [tags, setTags] = useState<any[]>([]);
  const hasLoadedRef = useRef(false);

  // Group series by study
  const studiesWithSeries = studies.map(study => ({
    ...study,
    series: series.filter(s => s.studyId === study.id)
  }));

  // Find RT structure series, image series, and registration series
  const rtStructureSeries = series.filter(s => s.modality === 'RTSTRUCT');
  const imageSeries = series.filter(s => ['CT', 'MR', 'PT'].includes(s.modality));
  const registrationSeries = series.filter(s => s.modality === 'REG');
  
  // Find MRI series that have registrations
  const ctSeries = imageSeries.filter(s => s.modality === 'CT');
  const mriSeries = imageSeries.filter(s => s.modality === 'MR');

  // Load patient tags
  useEffect(() => {
    if (patient) {
      fetch(`/api/patients/${patient.id}/tags`)
        .then(res => res.json())
        .then(data => setTags(data))
        .catch(err => console.error('Error loading tags:', err));
    }
  }, [patient]);

  // Load data when expanded
  useEffect(() => {
    if (isExpanded && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      
      // Load RT structures
      const loadRTStructures = async () => {
        for (const rtSeries of rtStructureSeries) {
          setLoadingStructures(prev => ({ ...prev, [rtSeries.id]: true }));
          try {
            const response = await fetch(`/api/rt-structures/${rtSeries.studyId}/${rtSeries.id}`);
            if (response.ok) {
              const data = await response.json();
              setRtStructures(prev => ({ ...prev, [rtSeries.id]: data.structures || [] }));
            }
          } catch (error) {
            console.error(`Error loading RT structures for series ${rtSeries.id}:`, error);
          } finally {
            setLoadingStructures(prev => ({ ...prev, [rtSeries.id]: false }));
          }
        }
      };
      
      // Load registration info
      const loadRegistrationInfo = async () => {
        if (studies.length > 0) {
          try {
            const response = await fetch(`/api/registrations/${studies[0].id}`);
            if (response.ok) {
              const data = await response.json();
              if (data && data.transformationMatrix) {
                setRegistrationInfo(data);
              }
            }
          } catch (err) {
            console.error('Error loading registration:', err);
          }
        }
      };
      
      loadRTStructures();
      loadRegistrationInfo();
    }
  }, [isExpanded]);

  const getModalityColor = (modality: string) => {
    switch (modality) {
      case 'CT': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      case 'MR': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
      case 'RTSTRUCT': return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'REG': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
      case 'PT': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
    }
  };

  // Simple placeholder image for now
  const getPlaceholderImage = (seriesId: number) => {
    // Return a simple placeholder URL or use the first image
    return `/api/series/${seriesId}/thumbnail`;
  };

  return (
    <Card className="bg-gray-900/80 border border-gray-700/50 hover:border-indigo-500/50 
                     transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/10
                     backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg font-semibold text-white">{patient.patientName}</h3>
            <p className="text-sm text-gray-500">ID: {patient.patientID}</p>
            {/* Display tags */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map(tag => (
                  <Badge
                    key={tag.id}
                    variant="secondary"
                    className="text-xs px-2 py-0"
                    style={{ 
                      backgroundColor: tag.color + '20', 
                      borderColor: tag.color, 
                      color: tag.color 
                    }}
                  >
                    {tag.tagValue}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge 
              variant="outline" 
              className="border-indigo-500/50 text-indigo-400 bg-indigo-500/10"
            >
              {patient.sex || 'Unknown'} • {patient.age || 'Age N/A'}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowEditDialog(true)}
              className="h-8 w-8 p-0"
            >
              <Edit className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Study Information */}
        {studiesWithSeries.map((study) => (
          <div key={study.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Calendar className="h-4 w-4" />
                <span>{
                  study.studyDate && !isNaN(Date.parse(study.studyDate))
                    ? format(new Date(study.studyDate), 'MMM d, yyyy')
                    : study.studyDate || 'Date N/A'
                }</span>
              </div>
              <div className="flex items-center gap-2">
                <FileStack className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-400">{study.series.length} series</span>
              </div>
            </div>

            {/* Series Preview Grid with GIF animations */}
            <div className="grid grid-cols-4 gap-2">
              {study.series.filter(s => ['CT', 'MR', 'PT'].includes(s.modality)).map((imageSeries) => (
                <div key={imageSeries.id} className="relative group">
                  <div className="aspect-square bg-gray-800 rounded-lg overflow-hidden border border-gray-700/50 
                              group-hover:border-indigo-500/50 transition-all duration-200
                              group-hover:shadow-md group-hover:shadow-indigo-500/20">
                    {imageSeries.imageCount > 1 ? (
                      <img 
                        src={`/api/series/${imageSeries.id}/gif`}
                        alt={`${imageSeries.modality} Series ${imageSeries.seriesNumber}`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Fallback to text display on error
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const fallback = target.nextSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div className={`w-full h-full flex items-center justify-center bg-gray-800 ${imageSeries.imageCount > 1 ? 'hidden' : ''}`}>
                      <div className="text-center">
                        <div className="text-3xl font-bold text-gray-600">{imageSeries.modality}</div>
                        <div className="text-xs text-gray-500">Series {imageSeries.seriesNumber}</div>
                      </div>
                    </div>
                  </div>
                  <Badge 
                    variant="secondary" 
                    className={`absolute bottom-1 right-1 text-xs px-1 py-0 ${getModalityColor(imageSeries.modality)}`}
                  >
                    {imageSeries.modality}
                  </Badge>
                  <div className="absolute top-1 left-1 text-xs text-white bg-black/70 px-1 rounded">
                    {imageSeries.imageCount} imgs
                  </div>
                </div>
              ))}
            </div>

            {/* Special Series Badges */}
            <div className="flex flex-wrap gap-2">
              {study.series.filter(s => s.modality === 'RTSTRUCT').map((rtSeries) => (
                <Badge 
                  key={rtSeries.id}
                  variant="secondary" 
                  className="bg-green-900/20 text-green-400 border-green-600/50"
                >
                  <Brain className="h-3 w-3 mr-1" />
                  RT Structure Set
                </Badge>
              ))}
              
              {registrationInfo && (
                <Badge 
                  variant="secondary" 
                  className="bg-orange-900/20 text-orange-400 border-orange-600/50"
                >
                  <GitBranch className="h-3 w-3 mr-1" />
                  Registration Available
                </Badge>
              )}
              
              {mriSeries.length > 0 && ctSeries.length > 0 && (
                <Badge 
                  variant="secondary" 
                  className="bg-purple-900/20 text-purple-400 border-purple-600/50"
                >
                  <Layers className="h-3 w-3 mr-1" />
                  Fusion Ready
                </Badge>
              )}
            </div>
          </div>
        ))}

        {/* Expanded Content */}
        {isExpanded && (
          <div className="mt-4 space-y-4 border-t border-gray-700 pt-4">
            {/* RT Structures */}
            {rtStructureSeries.map((rtSeries) => (
              <div key={rtSeries.id} className="space-y-2">
                <h4 className="text-sm font-medium text-green-400 flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  RT Structure Set
                </h4>
                {loadingStructures[rtSeries.id] ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading structures...
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {rtStructures[rtSeries.id]?.map((structure: any) => (
                      <div 
                        key={structure.roiNumber}
                        className="flex items-center gap-2 bg-gray-800/50 p-2 rounded-lg"
                      >
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{ 
                            backgroundColor: structure.color 
                              ? `rgb(${structure.color[0]}, ${structure.color[1]}, ${structure.color[2]})`
                              : '#666'
                          }}
                        />
                        <span className="text-xs text-gray-300 truncate">
                          {structure.structureName}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Registration Info - Enhanced with visual connections */}
            {registrationInfo && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-orange-400 flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Registration & Fusion Links
                </h4>
                <div className="bg-gray-800/50 p-4 rounded-lg space-y-4">
                  {/* Show CT Series */}
                  {ctSeries.map(ct => (
                    <div key={ct.id} className="space-y-3">
                      {/* Primary CT Series */}
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0">
                          <Badge className="bg-blue-900/20 text-blue-400 border-blue-600/50">
                            CT
                          </Badge>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-gray-300 font-medium">
                            {ct.seriesDescription || `CT Series ${ct.seriesNumber}`}
                          </p>
                          <p className="text-xs text-gray-500">
                            {ct.imageCount} images • Reference series
                          </p>
                        </div>
                      </div>
                      
                      {/* Registration Connection Visualization */}
                      <div className="relative pl-8">
                        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-400 via-orange-400 to-purple-400"></div>
                        <div className="absolute left-3 top-4 w-2.5 h-2.5 bg-orange-400 rounded-full ring-2 ring-gray-800"></div>
                        <div className="pl-4 py-2">
                          <p className="text-xs text-orange-400 font-medium">4x4 Registration Matrix</p>
                          <p className="text-xs text-gray-500">{registrationInfo.matrixType || 'RIGID'} transformation</p>
                        </div>
                      </div>
                      
                      {/* Connected MRI Series */}
                      <div className="space-y-2 pl-8">
                        {mriSeries.map((mri) => (
                          <div key={mri.id} className="flex items-center gap-3 relative">
                            <div className="absolute -left-4 top-3 w-2 h-2 bg-purple-400 rounded-full"></div>
                            <div className="flex-shrink-0">
                              <Badge className="bg-purple-900/20 text-purple-400 border-purple-600/50">
                                MR
                              </Badge>
                            </div>
                            <div className="flex-1">
                              <p className="text-sm text-gray-300">
                                {mri.seriesDescription || `MR Series ${mri.seriesNumber}`}
                              </p>
                              <p className="text-xs text-gray-500">
                                {mri.imageCount} images • Co-registered for fusion
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  
                  <div className="bg-gray-700/30 p-3 rounded-lg">
                    <p className="text-xs text-gray-400">
                      💡 This patient has multi-modal registration enabling CT/MRI fusion viewing with precise anatomical alignment
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-2">
            <Link href={`/enhanced-viewer?patientId=${patient.patientId}`}>
              <Button 
                size="sm" 
                className="bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-500"
              >
                <Eye className="h-4 w-4 mr-1" />
                Advanced Viewer
              </Button>
            </Link>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-400 hover:text-white"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" />
                Show Less
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" />
                Show More
              </>
            )}
          </Button>
        </div>
      </CardContent>
      
      {/* Metadata Edit Dialog */}
      <MetadataEditDialog
        open={showEditDialog}
        onClose={() => setShowEditDialog(false)}
        patient={patient}
        studies={studies}
        series={series}
        onUpdate={() => {
          // Reload tags after update
          if (patient) {
            fetch(`/api/patients/${patient.id}/tags`)
              .then(res => res.json())
              .then(data => setTags(data))
              .catch(err => console.error('Error loading tags:', err));
          }
          // You might want to reload patient data here too
          window.location.reload();
        }}
      />
    </Card>
  );
}