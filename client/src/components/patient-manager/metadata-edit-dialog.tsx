import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, Tag, Plus, X, Sparkles } from 'lucide-react';
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
  const [newTag, setNewTag] = useState({ type: 'custom', value: '', color: '#3b82f6' });
  const [loadingTags, setLoadingTags] = useState(false);

  useEffect(() => {
    if (open && patient) {
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
        body: JSON.stringify(patientData)
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
          tagType: newTag.type,
          tagValue: newTag.value,
          color: newTag.color
        })
      });
      
      if (response.ok) {
        const tag = await response.json();
        setTags([...tags, tag]);
        setNewTag({ type: 'custom', value: '', color: '#3b82f6' });
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Patient Metadata</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Patient Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Patient Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="patientName">Patient Name</Label>
                <Input
                  id="patientName"
                  value={patientData.patientName}
                  onChange={e => setPatientData({ ...patientData, patientName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="patientID">Patient ID</Label>
                <Input
                  id="patientID"
                  value={patientData.patientID}
                  onChange={e => setPatientData({ ...patientData, patientID: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="age">Age</Label>
                <Input
                  id="age"
                  value={patientData.age}
                  onChange={e => setPatientData({ ...patientData, age: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sex">Sex</Label>
                <Input
                  id="sex"
                  value={patientData.sex}
                  onChange={e => setPatientData({ ...patientData, sex: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Patient Tags</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateAnatomicalTags}
                disabled={loadingTags}
              >
                {loadingTags ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span className="ml-2">Auto-Generate</span>
              </Button>
            </div>
            
            {/* Existing Tags */}
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className="px-3 py-1"
                  style={{ backgroundColor: tag.color + '20', borderColor: tag.color, color: tag.color }}
                >
                  <span className="mr-1">{tag.tagValue}</span>
                  <button
                    onClick={() => handleDeleteTag(tag.id)}
                    className="ml-1 hover:opacity-70"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            
            {/* Add New Tag */}
            <div className="flex gap-2">
              <select
                className="px-3 py-2 rounded-md border bg-background"
                value={newTag.type}
                onChange={e => setNewTag({ ...newTag, type: e.target.value })}
              >
                <option value="custom">Custom</option>
                <option value="anatomical">Anatomical</option>
                <option value="registration">Registration</option>
                <option value="fusion">Fusion</option>
              </select>
              <Input
                placeholder="Tag value..."
                value={newTag.value}
                onChange={e => setNewTag({ ...newTag, value: e.target.value })}
                onKeyPress={e => e.key === 'Enter' && handleAddTag()}
              />
              <input
                type="color"
                value={newTag.color}
                onChange={e => setNewTag({ ...newTag, color: e.target.value })}
                className="w-12 h-10 rounded border cursor-pointer"
              />
              <Button onClick={handleAddTag} size="icon">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Series Descriptions */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Series Descriptions</h3>
            <div className="space-y-2">
              {series.map(s => (
                <div key={s.id} className="flex items-center gap-2">
                  <Badge className={getModalityColor(s.modality)}>
                    {s.modality}
                  </Badge>
                  <span className="text-sm text-gray-500">Series {s.seriesNumber}</span>
                  <Input
                    className="flex-1"
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