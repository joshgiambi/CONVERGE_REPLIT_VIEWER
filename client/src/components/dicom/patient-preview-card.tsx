import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, ImageIcon } from 'lucide-react';

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

interface PatientPreviewCardProps {
  patient: PatientPreview;
  rtStructures?: { [key: string]: any };
}

export function PatientPreviewCard({ patient, rtStructures }: PatientPreviewCardProps) {
  const getModalityColor = (modality: string) => {
    switch (modality) {
      case 'CT': return 'bg-blue-500';
      case 'MR': return 'bg-green-500';
      case 'RTSTRUCT': return 'bg-purple-500';
      case 'REG': return 'bg-amber-500';
      case 'RTDOSE': return 'bg-orange-500';
      case 'RTPLAN': return 'bg-red-500';
      case 'PET': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Unknown Date';
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}-${month}-${day}`;
  };

  const totalImages = patient.studies.reduce((sum, study) => sum + study.imageCount, 0);
  const allModalities = Array.from(new Set(patient.studies.flatMap(s => s.modalities)));

  return (
    <Card className="w-full border-gray-700 bg-gray-900/50">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-xl font-semibold text-white mb-1">
              {patient.patientName || 'Unknown Patient'}
            </h3>
            <p className="text-sm text-gray-400">ID: {patient.patientId}</p>
          </div>
          <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500">
            Preview
          </Badge>
        </div>

        {/* Modality Badges */}
        <div className="flex flex-wrap gap-2 mb-4">
          {allModalities.map(modality => (
            <Badge 
              key={modality} 
              variant="outline" 
              className={`${getModalityColor(modality)} text-white border-transparent`}
            >
              {modality}
            </Badge>
          ))}
        </div>

        {/* Study Info */}
        <div className="space-y-3">
          {patient.studies.map((study, index) => (
            <div key={study.studyId} className="bg-black/30 rounded p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-300">{formatDate(study.studyDate)}</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-1">
                    <ImageIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-300">{study.imageCount} images</span>
                  </div>
                  <span className="text-sm text-gray-400">({study.seriesCount} series)</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* RT Structures if any */}
        {rtStructures && Object.keys(rtStructures).length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-700">
            <p className="text-sm text-purple-400 mb-2">RT Structure Sets Available</p>
            <div className="text-xs text-gray-400">
              {Object.keys(rtStructures).length} structure set(s) with anatomical contours
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between text-sm">
          <span className="text-gray-400">Total Studies: {patient.studies.length}</span>
          <span className="text-gray-400">Total Images: {totalImages}</span>
        </div>
      </div>
    </Card>
  );
}