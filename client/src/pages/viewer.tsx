import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ViewerInterface } from '@/components/dicom/viewer-interface';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Home, Download, Save, List, FolderDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { log } from '@/lib/log';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckboxIndicator } from '@radix-ui/react-checkbox';
import { Checkbox } from '@/components/ui/checkbox';
import { resolveViewerBootstrap } from '@/lib/viewer-bootstrap';

export default function Viewer() {
  const [studyData, setStudyData] = useState<any>(null);
  const [, setLocation] = useLocation();
  const [contourSettings, setContourSettings] = useState({ width: 2, opacity: 80 });
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [seriesDescription, setSeriesDescription] = useState('');
  const [selectedExportItems, setSelectedExportItems] = useState<Set<string>>(new Set());
  const [exportItems, setExportItems] = useState<any[]>([]);
  const [currentRTSeriesId, setCurrentRTSeriesId] = useState<number | null>(null);
  const { toast } = useToast();
  
  const { data: studies, isLoading, error } = useQuery({
    queryKey: ['/api/studies'],
    queryFn: () => fetch('/api/studies').then(res => res.json())
  });
  
  useEffect(() => {
    let cancelled = false;

    const loadStudyData = async () => {
      log.debug('=== Enhanced Viewer Debug ===', 'viewer');
      log.debug(`Studies loaded: ${Array.isArray(studies) ? studies.length : 0}`, 'viewer');
      log.debug(`Loading: ${isLoading}`, 'viewer');
      if (error) log.debug(`Error: ${String(error)}`, 'viewer');

      if (!Array.isArray(studies) || studies.length === 0) {
        return;
      }

      const urlParams = new URLSearchParams(window.location.search);
      const studyId = urlParams.get('studyId');
      const patientId = urlParams.get('patientId');

      log.debug(`URL studyId: ${studyId}`, 'viewer');
      log.debug(`URL patientId: ${patientId}`, 'viewer');
      log.debug(
        `All patient IDs: ${JSON.stringify(
          studies.map((s: any) => ({ id: s.id, patientID: s.patientID, patientId: s.patientId })),
        )}`,
        'viewer',
      );

      const result = await resolveViewerBootstrap({
        studies,
        studyIdParam: studyId,
        patientIdParam: patientId,
      });

      if (cancelled) return;

      if (result.studyData) {
        log.debug(
          `Resolved viewer context: studyCount=${result.studyData.studies.length}, patientDbId=${result.patientDbId}`,
          'viewer',
        );
        setStudyData(result.studyData);
      } else {
        log.warn('NO STUDY FOUND!', 'viewer');
        setStudyData(null);
      }
    };

    loadStudyData();

    return () => {
      cancelled = true;
    };
  }, [studies, isLoading, error]);

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown Date';
    
    try {
      if (dateString.length === 8) {
        const year = dateString.substring(0, 4);
        const month = dateString.substring(4, 6);
        const day = dateString.substring(6, 8);
        const date = new Date(`${year}-${month}-${day}`);
        return date.toLocaleDateString();
      }
      return new Date(dateString).toLocaleDateString();
    } catch (error) {
      return dateString;
    }
  };

  const handleSave = () => {
    const currentDate = new Date();
    const defaultDescription = `RT Structure Set - ${currentDate.toLocaleDateString()} ${currentDate.toLocaleTimeString()}`;
    setSeriesDescription(defaultDescription);
    setShowSaveDialog(true);
  };

  const handleExport = async () => {
    if (!currentStudy) return;
    
    try {
      // Fetch all series for the current study
      const response = await fetch(`/api/studies/${currentStudy.id}/series`);
      const series = await response.json();
      
      // Prepare export items
      const items = [];
      for (const s of series) {
        items.push({
          id: `series-${s.id}`,
          type: 'series',
          name: `${s.modality} - ${s.seriesDescription || 'Unnamed Series'}`,
          description: `${s.imageCount || 0} images`,
          data: s
        });
      }
      
      setExportItems(items);
      setSelectedExportItems(new Set());
      setShowExportDialog(true);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load export items",
        variant: "destructive"
      });
    }
  };

  const handleSaveConfirm = async () => {
    if (!currentStudy || !currentRTSeriesId) {
      toast({ title: 'Error', description: 'No RT Structure Set loaded', variant: 'destructive' });
      return;
    }
    try {
      const res = await fetch(`/api/rt-structures/${currentRTSeriesId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: seriesDescription })
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: 'Success', description: `RT Structure Set saved as: ${seriesDescription}` });
      setShowSaveDialog(false);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save RT structure set', variant: 'destructive' });
    }
  };

  const handleExportConfirm = async () => {
    if (selectedExportItems.size === 0) {
      toast({
        title: "Warning",
        description: "Please select items to export",
        variant: "destructive"
      });
      return;
    }
    
    try {
      if (!currentStudy) return;
      const seriesIds = exportItems
        .filter((item) => selectedExportItems.has(item.id))
        .map((item) => item.data.id);

      const res = await fetch(`/api/studies/${currentStudy.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesIds })
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `study_${currentStudy.id}_export.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: 'Export started', description: `Exporting ${selectedExportItems.size} items...` });
      setShowExportDialog(false);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to export files', variant: 'destructive' });
    }
  };

  if (!studyData) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white">Loading enhanced viewer...</div>
      </div>
    );
  }

  const currentStudy = studyData.studies[0];

  return (
    <div className="min-h-screen bg-dicom-black text-white">
      {/* Enhanced Viewer Header */}
      <header className="fixed top-4 left-4 right-4 bg-gray-950/90 backdrop-blur-xl border border-gray-600/60 rounded-2xl px-6 py-3 z-50 shadow-2xl shadow-black/50 animate-slide-up">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center space-x-4">
            <div>
              <h1 className="text-xl font-black tracking-widest" style={{ letterSpacing: '0.25em' }}>
                <span style={{
                  color: 'white',
                  fontWeight: '900'
                }}>S</span>
                <span style={{
                  color: 'white',
                  fontWeight: '900'
                }}>U</span>
                <span style={{
                  color: 'white',
                  fontWeight: '900'
                }}>P</span>
                <span style={{
                  color: 'white',
                  fontWeight: '900'
                }}>E</span>
                <span style={{
                  color: 'white',
                  fontWeight: '900'
                }}>R</span>
                <span style={{
                  background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontWeight: '900'
                }}>B</span>
                <span style={{
                  background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontWeight: '900'
                }}>E</span>
                <span style={{
                  background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontWeight: '900'
                }}>A</span>
                <span style={{
                  background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontWeight: '900'
                }}>M</span>
              </h1>
            </div>
            
            {(studyData.patient || currentStudy) && (
              <div className="flex items-center space-x-3 pl-4 border-l border-gray-600">
                <div>
                  <h2 className="text-sm font-semibold text-dicom-yellow">
                    {studyData.patient?.patientName || currentStudy.patientName || 'Unknown Patient'}
                  </h2>
                  <p className="text-xs text-gray-400">
                    ID: {studyData.patient?.patientID || currentStudy.patientID || 'No ID'}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open('/', '_blank')}
              className="text-white hover:bg-white/10"
            >
              <List className="h-4 w-4 mr-2" />
              Patient List
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSave()}
              className="text-white hover:bg-white/10"
            >
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleExport()}
              className="text-white hover:bg-white/10"
            >
              <FolderDown className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="pt-24 pb-8 px-4">
        <ViewerInterface 
          studyData={studyData} 
          onContourSettingsChange={setContourSettings}
          contourSettings={contourSettings}
          onLoadedRTSeriesChange={setCurrentRTSeriesId}
        />
      </div>

      {/* Save Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-[425px] bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Save RT Structure Set</DialogTitle>
            <DialogDescription className="text-gray-400">
              Create a new version of the RT structure set
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="series-description" className="text-right text-white">
                Description
              </Label>
              <Input
                id="series-description"
                value={seriesDescription}
                onChange={(e) => setSeriesDescription(e.target.value)}
                className="col-span-3 bg-gray-800 border-gray-700 text-white"
              />
            </div>
            <div className="text-sm text-gray-400">
              This will create a new version of the RT structure set that can be retrieved later.
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowSaveDialog(false)}
              className="border-gray-600 text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSaveConfirm}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-[600px] max-h-[600px] bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Export DICOM Files</DialogTitle>
            <DialogDescription className="text-gray-400">
              Select the series you want to export
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectedExportItems.size === exportItems.length) {
                    setSelectedExportItems(new Set());
                  } else {
                    setSelectedExportItems(new Set(exportItems.map(item => item.id)));
                  }
                }}
                className="border-gray-600 text-gray-400 hover:bg-gray-800"
              >
                {selectedExportItems.size === exportItems.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {exportItems.map((item) => (
                <div key={item.id} className="flex items-center space-x-2 p-2 hover:bg-gray-700/50 rounded transition-colors">
                  <Checkbox
                    id={item.id}
                    checked={selectedExportItems.has(item.id)}
                    onCheckedChange={(checked) => {
                      const newSelected = new Set(selectedExportItems);
                      if (checked) {
                        newSelected.add(item.id);
                      } else {
                        newSelected.delete(item.id);
                      }
                      setSelectedExportItems(newSelected);
                    }}
                    className="border-gray-600 data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                  />
                  <Label
                    htmlFor={item.id}
                    className="flex-1 cursor-pointer"
                  >
                    <div className="font-medium text-white">{item.name}</div>
                    <div className="text-sm text-gray-400">{item.description}</div>
                  </Label>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowExportDialog(false)}
              className="border-gray-600 text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleExportConfirm}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Export {selectedExportItems.size} Item{selectedExportItems.size !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
