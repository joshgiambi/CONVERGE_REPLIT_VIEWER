import React, { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Calendar, FileStack, Stethoscope, Brain, Image, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'wouter';

interface PatientCardProps {
  patient: any;
  studies: any[];
  series: any[];
}

export function PatientCard({ patient, studies, series }: PatientCardProps) {
  const [hoveredThumbnail, setHoveredThumbnail] = useState<string | null>(null);
  const [scrollInterval, setScrollInterval] = useState<number | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<{ [key: string]: number }>({});
  const [thumbnailData, setThumbnailData] = useState<{ [key: string]: any[] }>({});

  // Group series by study
  const studiesWithSeries = studies.map(study => ({
    ...study,
    series: series.filter(s => s.studyId === study.id)
  }));

  // Find RT structure series and image series
  const rtStructureSeries = series.filter(s => s.modality === 'RTSTRUCT');
  const imageSeries = series.filter(s => ['CT', 'MR', 'PT'].includes(s.modality));

  useEffect(() => {
    // Load thumbnail data for each image series
    imageSeries.forEach(async (s) => {
      try {
        const response = await fetch(`/api/series/${s.id}/images`);
        if (response.ok) {
          const images = await response.json();
          setThumbnailData(prev => ({
            ...prev,
            [s.id]: images.slice(0, 20) // Load first 20 images for preview
          }));
        }
      } catch (error) {
        console.error(`Error loading thumbnails for series ${s.id}:`, error);
      }
    });
  }, [series]);

  const handleThumbnailHover = (seriesId: string) => {
    setHoveredThumbnail(seriesId);
    
    // Start scrolling through images
    const interval = window.setInterval(() => {
      setCurrentImageIndex(prev => {
        const current = prev[seriesId] || 0;
        const images = thumbnailData[seriesId] || [];
        return {
          ...prev,
          [seriesId]: (current + 1) % images.length
        };
      });
    }, 200); // Change image every 200ms
    
    setScrollInterval(interval);
  };

  const handleThumbnailLeave = () => {
    setHoveredThumbnail(null);
    if (scrollInterval) {
      clearInterval(scrollInterval);
      setScrollInterval(null);
    }
  };

  const getThumbnailUrl = (seriesId: string) => {
    const images = thumbnailData[seriesId];
    if (!images || images.length === 0) return null;
    
    const index = hoveredThumbnail === seriesId 
      ? (currentImageIndex[seriesId] || 0)
      : 0;
    
    const image = images[index];
    return image ? `/api/images/${image.id}/file` : null;
  };

  return (
    <Card className="bg-gray-900/80 border border-gray-700/50 hover:border-purple-500/50 
                     transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/10
                     backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg font-semibold text-white">{patient.patientName}</h3>
            <p className="text-sm text-gray-500">ID: {patient.patientId}</p>
          </div>
          <Badge 
            variant="outline" 
            className="border-purple-500/50 text-purple-400 bg-purple-500/10"
          >
            {patient.sex || 'Unknown'} • {patient.age || 'Age N/A'}
          </Badge>
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

            {/* RT Structure Tags */}
            {study.series.filter(s => s.modality === 'RTSTRUCT').map((rtSeries) => (
              <TooltipProvider key={rtSeries.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge 
                      variant="secondary" 
                      className="bg-green-900/20 text-green-400 border-green-600/50 cursor-help"
                    >
                      <Brain className="h-3 w-3 mr-1" />
                      RT Structure Set
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-gray-800 border-gray-700 p-3 max-w-xs">
                    <RTStructurePreview seriesId={rtSeries.id} />
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}

            {/* Image Series Thumbnails */}
            <div className="grid grid-cols-4 gap-2">
              {study.series.filter(s => ['CT', 'MR', 'PT'].includes(s.modality)).map((imageSeries) => (
                <div
                  key={imageSeries.id}
                  className="relative group"
                  onMouseEnter={() => handleThumbnailHover(imageSeries.id)}
                  onMouseLeave={handleThumbnailLeave}
                >
                  <div className="aspect-square bg-gray-800 rounded-lg overflow-hidden border border-gray-700/50 
                              group-hover:border-purple-500/50 transition-all duration-200
                              group-hover:shadow-md group-hover:shadow-purple-500/20">
                    {getThumbnailUrl(imageSeries.id) ? (
                      <img
                        src={getThumbnailUrl(imageSeries.id)}
                        alt={`${imageSeries.modality} ${imageSeries.seriesNumber}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Image className="h-8 w-8 text-gray-600" />
                      </div>
                    )}
                  </div>
                  <Badge 
                    variant="secondary" 
                    className="absolute bottom-1 right-1 text-xs px-1 py-0 bg-black/70"
                  >
                    {imageSeries.modality}
                  </Badge>
                  {hoveredThumbnail === imageSeries.id && (
                    <div className="absolute top-1 left-1 text-xs text-white bg-black/70 px-1 rounded">
                      {(currentImageIndex[imageSeries.id] || 0) + 1}/{thumbnailData[imageSeries.id]?.length || 0}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <Link href={`/enhanced-viewer?patientId=${patient.patientId}`}>
            <Button 
              size="sm" 
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white border-0"
            >
              <Eye className="h-4 w-4 mr-1" />
              View Images
            </Button>
          </Link>
          {rtStructureSeries.length > 0 && (
            <Badge 
              variant="secondary" 
              className="bg-green-900/20 text-green-400 border-green-600/50"
            >
              <Brain className="h-3 w-3 mr-1" />
              RT Structures Available
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Component to show RT structure preview on hover
function RTStructurePreview({ seriesId }: { seriesId: number }) {
  const [structures, setStructures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/rt-structures/${seriesId}/contours`)
      .then(res => res.json())
      .then(data => {
        setStructures(data.structures || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading RT structures:', err);
        setLoading(false);
      });
  }, [seriesId]);

  if (loading) {
    return <div className="text-sm text-gray-400">Loading structures...</div>;
  }

  return (
    <div className="space-y-1">
      <div className="text-sm font-semibold text-white mb-2">
        {structures.length} structures in set:
      </div>
      <div className="max-h-60 overflow-y-auto space-y-1">
        {structures.slice(0, 10).map((structure: any) => (
          <div key={structure.roiNumber} className="flex items-center gap-2 text-xs">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: `rgb(${structure.color.join(',')})` }}
            />
            <span className="text-gray-300">{structure.structureName}</span>
          </div>
        ))}
        {structures.length > 10 && (
          <div className="text-xs text-gray-500 pt-1">
            ... and {structures.length - 10} more
          </div>
        )}
      </div>
    </div>
  );
}