import React, { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar, FileStack, Brain, Eye, ChevronDown, ChevronUp, Layers, GitBranch, Loader2, Edit, Tag, Star, ArrowRight, Link as LinkIcon } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'wouter';
import { MetadataEditDialog } from './metadata-edit-dialog';
import { DicomThumbnail } from './dicom-thumbnail';
import { useToast } from '@/hooks/use-toast';
import type { AssociationResponse, RegistrationAssociation } from '@/types/fusion';

interface PatientCardProps {
  patient: any;
  studies: any[];
  series: any[];
  isSelectable?: boolean;
  isSelected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  onUpdate?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onPatientOpened?: () => void;
}

export function PatientCard({ patient, studies, series, isSelectable, isSelected, onSelectionChange, onUpdate, isFavorite, onToggleFavorite, onPatientOpened }: PatientCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [rtStructures, setRtStructures] = useState<{ [key: number]: any[] }>({});
  const [loadingStructures, setLoadingStructures] = useState<{ [key: number]: boolean }>({});
  const [associationData, setAssociationData] = useState<AssociationResponse | null>(null);
  const [loadingAssociations, setLoadingAssociations] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [tags, setTags] = useState<any[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const hasLoadedRef = useRef(false);
  const { toast } = useToast();

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
            const response = await fetch(`/api/rt-structures/${rtSeries.id}/contours`);
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
      
      // Load association data
      const loadAssociationData = async () => {
        if (patient?.id) {
          setLoadingAssociations(true);
          try {
            const response = await fetch(`/api/registration/associations?patientId=${patient.id}`);
            if (response.ok) {
              const data = await response.json();
              setAssociationData(data);
            }
          } catch (err) {
            console.error('Error loading associations:', err);
          } finally {
            setLoadingAssociations(false);
          }
        }
      };
      
      loadRTStructures();
      loadAssociationData();
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

  // Parse DICOM date format (YYYYMMDD) to JavaScript Date
  const parseDicomDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    
    // Check if it's YYYYMMDD format (8 digits)
    if (/^\d{8}$/.test(dateStr)) {
      const year = parseInt(dateStr.substring(0, 4));
      const month = parseInt(dateStr.substring(4, 6)) - 1; // JS months are 0-indexed
      const day = parseInt(dateStr.substring(6, 8));
      return new Date(year, month, day);
    }
    
    // Try standard date parsing for other formats
    const parsed = Date.parse(dateStr);
    return isNaN(parsed) ? null : new Date(parsed);
  };
  
  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete patient ${patient.patientName}? This will delete all associated studies, series, and images.`)) {
      return;
    }
    
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/patients/${patient.id}?full=true`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete patient');
      }
      
      toast({
        title: "Patient deleted",
        description: `Successfully deleted ${patient.patientName} and all associated data.`,
      });
      
      if (onUpdate) {
        onUpdate();
      }
    } catch (error) {
      console.error('Error deleting patient:', error);
      toast({
        title: "Error",
        description: "Failed to delete patient. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="bg-gray-950/90 backdrop-blur-xl border border-gray-600/60 shadow-2xl shadow-black/50
                     hover:border-indigo-500/50 transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/10 w-full">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-4">
              {isSelectable && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => onSelectionChange?.(checked as boolean)}
                  className="h-5 w-5 border-gray-600 data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                />
              )}
              <div>
                <h3 className="text-base font-bold text-white">{patient.patientName}</h3>
                <p className="text-sm font-semibold text-gray-400">{patient.patientID}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge 
                  variant="outline" 
                  className="border-indigo-500/50 text-indigo-400 bg-indigo-500/10"
                >
                  {patient.patientSex || 'Unknown'} • {patient.patientAge || 'Age N/A'}
                </Badge>
                {tags.map(tag => (
                  <Badge
                    key={tag.id}
                    variant="secondary"
                    className="text-xs px-2 py-0.5"
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
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onToggleFavorite && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onToggleFavorite}
                className={`h-8 w-8 p-0 transition-colors ${isFavorite ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-400 hover:text-white'}`}
              >
                <Star className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
              </Button>
            )}
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
          <div key={study.id} className="space-y-2">
            {/* Study Header Row */}
            <div className="flex items-center justify-between pb-2 border-b border-gray-800">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Calendar className="h-4 w-4" />
                  <span>{
                    (() => {
                      const date = parseDicomDate(study.studyDate);
                      return date ? format(date, 'MMMM d, yyyy') : 'Date N/A';
                    })()
                  }</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileStack className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-400">{study.series.length} series</span>
                </div>
              </div>
              
              {/* Special Status Badges */}
              <div className="flex items-center gap-2">
                {study.series.some(s => s.modality === 'RTSTRUCT') && (
                  <Badge 
                    variant="secondary" 
                    className="bg-green-900/20 text-green-400 border-green-600/50"
                  >
                    <Brain className="h-3 w-3 mr-1" />
                    RT Structures
                  </Badge>
                )}
                
                {associationData?.associations.length && (
                  <Badge 
                    variant="secondary" 
                    className="bg-orange-900/20 text-orange-400 border-orange-600/50"
                  >
                    <GitBranch className="h-3 w-3 mr-1" />
                    {associationData.associations.length} Association{associationData.associations.length !== 1 ? 's' : ''}
                  </Badge>
                )}
                
                {associationData?.associations.some(a => a.relationship === 'shared-frame') && (
                  <Badge 
                    variant="secondary" 
                    className="bg-blue-900/20 text-blue-400 border-blue-600/50"
                  >
                    <LinkIcon className="h-3 w-3 mr-1" />
                    Co-registered
                  </Badge>
                )}
              </div>
            </div>

            {/* Simple Series Summary - Main View */}
            <div className="flex items-center gap-6">
              {study.series.filter(s => ['CT', 'MR', 'PT'].includes(s.modality)).map((imageSeries) => (
                <div key={imageSeries.id} className="flex items-center gap-3">
                  <Badge 
                    variant="secondary" 
                    className={`${getModalityColor(imageSeries.modality)} text-xs px-2 py-0.5`}
                  >
                    {imageSeries.modality}
                  </Badge>
                  <div className="text-sm text-gray-400">
                    {imageSeries.seriesDescription || `Series ${imageSeries.seriesNumber || 1}`} • {imageSeries.imageCount} imgs
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Expanded Content */}
        {isExpanded && (
          <div className="mt-4 space-y-4 border-t border-gray-700 pt-4">
            {/* Compact Scan Details Table */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-indigo-400 flex items-center gap-2">
                <FileStack className="h-4 w-4" />
                Detailed Scan List
              </h4>
              <div className="bg-gray-800/30 rounded-lg p-3">
                <div className="space-y-1">
                  <div className="flex items-center text-xs text-gray-400 font-mono border-b border-gray-700/50 pb-1">
                    <span className="w-10">ID</span>
                    <span className="w-8">#</span>
                    <span className="w-10">Type</span>
                    <span className="flex-1 min-w-0">Description</span>
                    <span className="w-12 text-right">Imgs</span>
                    <span className="w-16 text-right">Vendor</span>
                    <span className="w-24 text-right">Actions</span>
                  </div>
                  {studiesWithSeries.flatMap(study => study.series)
                    .filter(s => ['CT', 'MR', 'PT', 'RTSTRUCT', 'REG'].includes(s.modality))
                    .sort((a, b) => (a.seriesNumber || 999) - (b.seriesNumber || 999))
                    .map((s) => {
                      const association = associationData?.associations.find(assoc => 
                        assoc.siblingSeriesIds.includes(s.id)
                      );
                      const isPrimary = association?.targetSeriesId === s.id;
                      const isCtac = associationData?.ctacSeriesIds.includes(s.id);
                      const isCoReg = association && association.relationship === 'shared-frame';
                      const isReg = association && association.relationship === 'registered';

                      const handleDeleteSeries = async () => {
                        if (!confirm(`Delete series ${s.seriesDescription || s.id}? This removes files and DB rows.`)) return;
                        try {
                          const res = await fetch(`/api/series/${s.id}`, { method: 'DELETE' });
                          if (!res.ok) throw new Error('Failed');
                          toast({ title: 'Series deleted', description: `Series ${s.id} removed.` });
                          if (onUpdate) onUpdate();
                        } catch (err) {
                          toast({ title: 'Delete failed', description: `Could not delete series ${s.id}`, variant: 'destructive' });
                        }
                      };

                      return (
                        <div 
                          key={s.id} 
                          className={`flex items-center text-xs font-mono py-0.5 px-1 rounded-sm ${
                            isPrimary ? 'bg-green-900/20' : 
                            isCoReg ? 'bg-blue-900/20' : 
                            isReg ? 'bg-orange-900/20' : 
                            'hover:bg-gray-700/20'
                          }`}
                        >
                          <span className="w-10 text-gray-300 font-bold">{s.id}</span>
                          <span className="w-8 text-gray-400">{s.seriesNumber || '?'}</span>
                          <div className="w-10">
                            <Badge className={`${getModalityColor(s.modality)} text-xs px-1 py-0`}>
                              {s.modality}
                            </Badge>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-gray-200 truncate text-xs">
                                {s.seriesDescription || `Series ${s.seriesNumber || '?'}`}
                              </span>
                              {isPrimary && <span className="text-green-400 text-xs">●</span>}
                              {isCtac && <span className="text-yellow-400 text-xs">⚡</span>}
                              {isCoReg && !isPrimary && <LinkIcon className="h-2.5 w-2.5 text-blue-400" />}
                              {isReg && !isPrimary && <GitBranch className="h-2.5 w-2.5 text-orange-400" />}
                            </div>
                          </div>
                          <span className="w-12 text-gray-400 text-right text-xs">{s.imageCount}</span>
                          <span className="w-16 text-gray-500 text-right text-xs truncate">
                            {(s as any).metadata?.manufacturer?.substring(0, 6) || '--'}
                          </span>
                          <span className="w-24 text-right">
                            <Button size="sm" variant="ghost" className="text-red-300 hover:text-red-100"
                              onClick={handleDeleteSeries}
                            >
                              Delete
                            </Button>
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Eclipse-Style Fusion Mapping */}
            {associationData?.associations.length && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-orange-400 flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Eclipse-Style Fusion Mapping
                </h4>
                <div className="space-y-3">
                  {(() => {
                    // Group series by associations across all studies
                    const allSeries = studiesWithSeries.flatMap(study => study.series);
                    const processedSeriesIds = new Set<number>();
                    const mappings: Array<{
                      type: 'association' | 'standalone';
                      association?: RegistrationAssociation;
                      series: any[];
                      rtStructures?: any[];
                    }> = [];

                    // Process associations
                    associationData.associations.forEach(assoc => {
                      const associatedSeries = [
                        ...(assoc.targetSeriesId ? [allSeries.find(s => s.id === assoc.targetSeriesId)] : []),
                        ...assoc.sourcesSeriesIds.map(id => allSeries.find(s => s.id === id))
                      ].filter(Boolean);

                      if (associatedSeries.length > 0) {
                        // Find RT structures associated with these series
                        const associatedRTStructures = allSeries.filter(s => 
                          s.modality === 'RTSTRUCT' && 
                          associatedSeries.some(imgS => imgS.studyId === s.studyId)
                        );

                        mappings.push({
                          type: 'association',
                          association: assoc,
                          series: associatedSeries,
                          rtStructures: associatedRTStructures
                        });
                        associatedSeries.forEach(s => processedSeriesIds.add(s.id));
                      }
                    });

                    return mappings.map((mapping, idx) => (
                      <div key={idx} className="bg-gray-800/20 rounded-lg p-3">
                        {mapping.type === 'association' && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Co-registered series in dashed box */}
                              {mapping.association?.relationship === 'shared-frame' && mapping.series.length > 1 ? (
                                <div className="border-2 border-dashed border-blue-400/50 bg-blue-900/5 rounded-lg p-2 flex items-center gap-2">
                                  <LinkIcon className="h-3 w-3 text-blue-400 flex-shrink-0" />
                                  <div className="flex items-center gap-3">
                                    {mapping.series.map((s) => (
                                      <div key={s.id} className="flex items-center gap-2">
                                        <Badge className={`${getModalityColor(s.modality)} text-xs px-1.5 py-0.5`}>
                                          {s.modality}
                                        </Badge>
                                        <span className="text-xs text-gray-200">
                                          {s.seriesDescription?.substring(0, 15) || `S${s.seriesNumber}`} ({s.id})
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                  <span className="text-xs text-blue-300 ml-2">Co-registered</span>
                                </div>
                              ) : (
                                // Registration relationship with target in solid box
                                <div className="flex items-center gap-3 flex-wrap">
                                  {/* Source series */}
                                  <div className="flex items-center gap-2">
                                    {mapping.series.filter(s => s.id !== mapping.association?.targetSeriesId).map(s => (
                                      <div key={s.id} className="flex items-center gap-2">
                                        <Badge className={`${getModalityColor(s.modality)} text-xs px-1.5 py-0.5`}>
                                          {s.modality}
                                        </Badge>
                                        <span className="text-xs text-gray-300">
                                          {s.seriesDescription?.substring(0, 12) || `S${s.seriesNumber}`} ({s.id})
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                  
                                  {/* Connection arrow with REG info */}
                                  {mapping.association?.regFile && (
                                    <div className="flex items-center gap-1">
                                      <div className="w-8 h-px bg-orange-400"></div>
                                      <ArrowRight className="h-3 w-3 text-orange-400" />
                                      <span className="text-xs text-orange-300 bg-orange-900/20 px-1 rounded">
                                        REG: {mapping.association.regFile.split('/').pop()}
                                      </span>
                                    </div>
                                  )}
                                  
                                  {/* Target series in solid box */}
                                  {mapping.association?.targetSeriesId && (() => {
                                    const target = mapping.series.find(s => s.id === mapping.association?.targetSeriesId);
                                    return target ? (
                                      <div className="border-2 border-solid border-green-400/60 bg-green-900/10 rounded-lg p-2 flex items-center gap-2">
                                        <Badge className={`${getModalityColor(target.modality)} text-xs px-1.5 py-0.5`}>
                                          {target.modality}
                                        </Badge>
                                        <span className="text-xs text-gray-200">
                                          {target.seriesDescription?.substring(0, 12) || `S${target.seriesNumber}`} ({target.id})
                                        </span>
                                        <span className="text-xs text-green-300">Primary</span>
                                      </div>
                                    ) : null;
                                  })()}
                                </div>
                              )}
                            </div>

                            {/* RT Structures attachment */}
                            {mapping.rtStructures && mapping.rtStructures.length > 0 && (
                              <div className="ml-4 flex items-center gap-2">
                                <div className="w-4 h-px bg-green-400"></div>
                                <div className="flex items-center gap-2">
                                  <Brain className="h-3 w-3 text-green-400" />
                                  <span className="text-xs text-green-300">
                                    {mapping.rtStructures.length} RT Structure{mapping.rtStructures.length !== 1 ? 's' : ''}
                                  </span>
                                  {mapping.rtStructures.map(rt => (
                                    <span key={rt.id} className="text-xs text-gray-400">
                                      {rt.seriesDescription?.substring(0, 10) || 'Structures'} ({rt.id})
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}

            {/* Image Thumbnails */}
            {imageSeries.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-blue-400 flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Image Series
                </h4>
                <div className="flex gap-2 flex-wrap">
                  {imageSeries.map((series) => (
                    <div key={series.id} className="relative group">
                      <DicomThumbnail 
                        seriesId={series.id}
                        modality={series.modality}
                        imageCount={series.imageCount}
                      />
                      <Badge 
                        variant="secondary" 
                        className={`absolute -top-1 -right-1 ${getModalityColor(series.modality)} text-xs px-1.5 py-0.5 font-bold`}
                      >
                        {series.modality}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                  <div className="grid grid-cols-6 gap-1.5">
                    {rtStructures[rtSeries.id]?.map((structure: any) => (
                      <div 
                        key={structure.roiNumber}
                        className="flex items-center gap-1.5 bg-gray-800/50 p-1.5 rounded"
                      >
                        <div 
                          className="w-2 h-2 rounded-full flex-shrink-0"
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

            {/* Detailed Association Information - Only in Expanded View */}
            {associationData?.associations.length && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-orange-400 flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Detailed Fusion Associations
                </h4>
                <div className="space-y-3">
                  {associationData.associations.map((assoc, idx) => {
                    const targetSeries = series.find(s => s.id === assoc.targetSeriesId);
                    const sourceSeries = assoc.sourcesSeriesIds.map(id => series.find(s => s.id === id)).filter(Boolean);
                    const isRegistered = assoc.relationship === 'registered';
                    
                    return (
                      <div key={idx} className="bg-gray-800/30 rounded-lg p-3 text-xs">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 mt-0.5">
                            <Badge variant="outline" className={
                              isRegistered 
                                ? "text-orange-300 border-orange-500/50" 
                                : "text-blue-300 border-blue-500/50"
                            }>
                              {isRegistered ? 'REG' : 'Co-reg'}
                            </Badge>
                          </div>
                          <div className="flex-1 space-y-1">
                            {/* Association details */}
                            <div className="text-gray-300">
                              <strong>ID {assoc.studyId}</strong> • 
                              {assoc.regFile && <span className="ml-1 text-orange-300">REG: {assoc.regFile.split('/').pop()}</span>}
                              {assoc.sourceFoR !== assoc.targetFoR && <span className="ml-1 text-purple-300">Cross-FoR</span>}
                            </div>
                            
                            {/* Series connections */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {sourceSeries.map(s => (
                                <span key={s.id} className="text-gray-400">
                                  {s.modality}({s.id})
                                </span>
                              ))}
                              <ArrowRight className="h-3 w-3 text-gray-500" />
                              {targetSeries && (
                                <span className="text-green-300 font-medium">
                                  {targetSeries.modality}({targetSeries.id}) PRIMARY
                                </span>
                              )}
                            </div>

                            {/* Transform candidates */}
                            {isRegistered && assoc.transformCandidates?.length > 0 && (
                              <div className="text-gray-500">
                                {assoc.transformCandidates.length} transform candidate{assoc.transformCandidates.length !== 1 ? 's' : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-2">
            <Link href={`/enhanced-viewer?patientId=${patient.patientID}`}>
              <Button 
                size="sm" 
                className="bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-500"
                onClick={onPatientOpened}
              >
                <Eye className="h-4 w-4 mr-1" />
                View
              </Button>
            </Link>
            <Link href={`/fusion-test?patientId=${patient.patientID}`}>
              <Button
                size="sm"
                variant="outline"
                className="border-cyan-500 text-cyan-300 hover:bg-cyan-500/10"
              >
                <Layers className="h-4 w-4 mr-1" />
                Fusion Test
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
          // Call parent's onUpdate if provided
          if (onUpdate) {
            onUpdate();
          }
        }}
      />
    </Card>
  );
}
