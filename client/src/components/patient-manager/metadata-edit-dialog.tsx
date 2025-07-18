import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, Tag, Plus, X, Sparkles, User, Hash, Calendar, Users, Layers } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface MetadataEditDialogProps {
  open: boolean;
  onClose: () => void;
  patient: any;
  studies: any[];
  series: any[];
  onUpdate: () => void;
}

export function MetadataEditDialog({ open, onClose, patient, studies, series, onUpdate }: MetadataEditDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [patientData, setPatientData] = useState({
    patientName: patient?.patientName || '',
    patientID: patient?.patientID || '',
    age: patient?.age || '',
    sex: patient?.sex || ''
  });
  
  const [seriesDescriptions, setSeriesDescriptions] = useState<Record<number, string>>({});
  const [tags, setTags] = useState<any[]>([]);
  const [newTag, setNewTag] = useState({ value: '' });
  const [loadingTags, setLoadingTags] = useState(false);

  useEffect(() => {
    if (open && patient) {
      // Reset patient data when dialog opens
      setPatientData({
        patientName: patient.patientName || '',
        patientID: patient.patientID || '',
        age: patient.patientAge || '',
        sex: patient.patientSex || ''
      });
      
      // Initialize series descriptions
      const descriptions: Record<number, string> = {};
      series.forEach(s => {
        descriptions[s.id] = s.seriesDescription || '';
      });
      setSeriesDescriptions(descriptions);
      
      // Load patient tags
      loadTags();
    }
  }, [open, patient, series]);

  const loadTags = async () => {
    if (!patient) return;
    
    try {
      const response = await fetch(`/api/patients/${patient.id}/tags`);
      if (response.ok) {
        const tagsData = await response.json();
        setTags(tagsData);
      }
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  };

  const handleSavePatientMetadata = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/patients/${patient.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: patientData.patientName,
          patientID: patientData.patientID,
          patientAge: patientData.age,
          patientSex: patientData.sex
        })
      });
      
      if (response.ok) {
        toast({
          title: "Success",
          description: "Patient metadata updated successfully"
        });
        onUpdate();
      } else {
        throw new Error('Failed to update patient metadata');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update patient metadata",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSeriesDescription = async (seriesId: number) => {
    try {
      const response = await fetch(`/api/series/${seriesId}/description`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: seriesDescriptions[seriesId] })
      });
      
      if (response.ok) {
        toast({
          title: "Success",
          description: "Series description updated"
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update series description",
        variant: "destructive"
      });
    }
  };

  const handleAddTag = async () => {
    if (!newTag.value.trim()) return;
    
    try {
      const response = await fetch(`/api/patients/${patient.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tagType: 'general',
          tagValue: newTag.value,
          color: '#6b7280' // neutral gray
        })
      });
      
      if (response.ok) {
        const tag = await response.json();
        setTags([...tags, tag]);
        setNewTag({ value: '' });
        toast({
          title: "Success",
          description: "Tag added successfully"
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add tag",
        variant: "destructive"
      });
    }
  };

  const handleDeleteTag = async (tagId: number) => {
    try {
      const response = await fetch(`/api/tags/${tagId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        setTags(tags.filter(t => t.id !== tagId));
        toast({
          title: "Success",
          description: "Tag removed"
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to remove tag",
        variant: "destructive"
      });
    }
  };

  const handleGenerateAnatomicalTags = async () => {
    setLoadingTags(true);
    try {
      const response = await fetch(`/api/patients/${patient.id}/tags/generate`, {
        method: 'POST'
      });
      
      if (response.ok) {
        const newTags = await response.json();
        await loadTags(); // Reload all tags
        toast({
          title: "Success",
          description: `Generated ${newTags.length} anatomical tags`
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate anatomical tags",
        variant: "destructive"
      });
    } finally {
      setLoadingTags(false);
    }
  };

  const getModalityColor = (modality: string) => {
    switch (modality) {
      case 'CT': return 'text-blue-400';
      case 'MR': return 'text-purple-400';
      case 'RTSTRUCT': return 'text-green-400';
      case 'REG': return 'text-orange-400';
      case 'PT': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  const tagPresets = [
    { type: 'anatomical', label: 'Anatomical', icon: '🧠', colors: ['#8b5cf6', '#7c3aed', '#6d28d9'] },
    { type: 'registration', label: 'Registration', icon: '🔗', colors: ['#f59e0b', '#d97706', '#b45309'] },
    { type: 'fusion', label: 'Fusion', icon: '🔀', colors: ['#10b981', '#059669', '#047857'] },
    { type: 'custom', label: 'Custom', icon: '✏️', colors: ['#3b82f6', '#2563eb', '#1d4ed8'] }
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-gray-900 border-gray-700">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">Edit Patient Metadata</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Patient Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
              <User className="h-5 w-5 text-indigo-400" />
              Patient Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="patientName" className="text-gray-300">Patient Name</Label>
                <Input
                  id="patientName"
                  value={patientData.patientName}
                  onChange={e => setPatientData({ ...patientData, patientName: e.target.value })}
                  className="bg-gray-800 border-gray-600 text-white focus:border-indigo-500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="patientID" className="text-gray-300">Patient ID</Label>
                <Input
                  id="patientID"
                  value={patientData.patientID}
                  onChange={e => setPatientData({ ...patientData, patientID: e.target.value })}
                  className="bg-gray-800 border-gray-600 text-white focus:border-indigo-500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="age" className="text-gray-300">Age</Label>
                <Input
                  id="age"
                  value={patientData.age}
                  onChange={e => setPatientData({ ...patientData, age: e.target.value })}
                  className="bg-gray-800 border-gray-600 text-white focus:border-indigo-500"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sex" className="text-gray-300">Sex</Label>
                <Input
                  id="sex"
                  value={patientData.sex}
                  onChange={e => setPatientData({ ...patientData, sex: e.target.value })}
                  className="bg-gray-800 border-gray-600 text-white focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
                <Tag className="h-5 w-5 text-purple-400" />
                Patient Tags
              </h3>
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateAnatomicalTags}
                disabled={loadingTags}
                className="border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
              >
                {loadingTags ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span className="ml-2">Auto-Generate from RT Structures</span>
              </Button>
            </div>
            
            {/* Existing Tags */}
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className="px-3 py-1 flex items-center gap-1 bg-gray-700/50 border border-gray-600 text-gray-200"
                >
                  <span>{tag.tagValue}</span>
                  <button
                    onClick={() => handleDeleteTag(tag.id)}
                    className="ml-2 hover:text-red-400 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            
            {/* Add New Tag */}
            <div className="flex gap-2 items-center">
              <Input
                placeholder="Add a tag..."
                value={newTag.value}
                onChange={e => setNewTag({ ...newTag, value: e.target.value })}
                onKeyPress={e => e.key === 'Enter' && handleAddTag()}
                className="bg-gray-800 border-gray-600 text-white focus:border-indigo-500 flex-1"
              />
              <Button 
                onClick={handleAddTag} 
                size="icon"
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Series Descriptions */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
              <Layers className="h-5 w-5 text-blue-400" />
              Series Descriptions
            </h3>
            <div className="space-y-2">
              {series.map(s => (
                <div key={s.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-800/50">
                  <Badge 
                    variant="outline"
                    className={`${getModalityColor(s.modality)} border-current bg-current/10`}
                  >
                    {s.modality}
                  </Badge>
                  <span className="text-sm text-gray-400 min-w-[80px]">Series {s.seriesNumber}</span>
                  <Input
                    className="flex-1 bg-gray-800 border-gray-600 text-white focus:border-indigo-500"
                    placeholder="Series description..."
                    value={seriesDescriptions[s.id] || ''}
                    onChange={e => setSeriesDescriptions({
                      ...seriesDescriptions,
                      [s.id]: e.target.value
                    })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSaveSeriesDescription(s.id)}
                    className="text-gray-400 hover:text-white hover:bg-gray-700"
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSavePatientMetadata} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Patient Info
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}