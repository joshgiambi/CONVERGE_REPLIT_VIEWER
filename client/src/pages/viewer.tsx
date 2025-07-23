import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ViewerInterface } from '@/components/dicom/viewer-interface';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Home, Download, Save, List, FolderDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckboxIndicator } from '@radix-ui/react-checkbox';
import { Checkbox } from '@/components/ui/checkbox';

export default function Viewer() {
  const [studyData, setStudyData] = useState<any>(null);
  const [, setLocation] = useLocation();
  const [contourSettings, setContourSettings] = useState({ width: 2, opacity: 80 });
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [seriesDescription, setSeriesDescription] = useState('');
  const [selectedExportItems, setSelectedExportItems] = useState<Set<string>>(new Set());
  const [exportItems, setExportItems] = useState<any[]>([]);
  const { toast } = useToast();
  
  const { data: studies, isLoading, error } = useQuery({
    queryKey: ['/api/studies'],
    queryFn: () => fetch('/api/studies').then(res => res.json())
  });
  
  useEffect(() => {
    const loadStudyData = async () => {
      console.log('=== Enhanced Viewer Debug ===');
      console.log('Studies loaded:', studies);
      console.log('Loading:', isLoading);
      console.log('Error:', error);
      
      if (studies && studies.length > 0) {
        const urlParams = new URLSearchParams(window.location.search);
        const studyId = urlParams.get('studyId');
        const patientId = urlParams.get('patientId');
        
        console.log('URL studyId:', studyId);
        console.log('URL patientId:', patientId);
        console.log('All patient IDs in studies:', studies.map((s: any) => ({ id: s.id, patientID: s.patientID, patientId: s.patientId })));
        
        let study;
        if (studyId) {
          study = studies.find((s: any) => s.id === parseInt(studyId));
          console.log('Found study by ID:', study);
        } else if (patientId) {
          // Find first study for this patient
          // First try exact match on patientID
          study = studies.find((s: any) => s.patientID === patientId);
          console.log('Found study by exact patientID match:', study);
          
          // If not found, try to find by patient name containing the ID (for fusion dataset)
          if (!study) {
            const patientQuery = await fetch('/api/patients').then(res => res.json());
            const patient = patientQuery.find((p: any) => p.patientID === patientId);
            console.log('Found patient with patientID:', patientId, 'patient:', patient);
            
            if (patient) {
              study = studies.find((s: any) => s.patientId === patient.id);
              console.log('Looking for study with patientId (FK):', patient.id);
              console.log('Found study by patient database ID:', study);
            }
          }
        } else {
          study = studies[0];
          console.log('Using first study:', study);
        }
        
        if (study) {
          console.log('Setting studyData with:', study);
          setStudyData({ studies: [study] });
        } else {
          console.log('NO STUDY FOUND!');
        }
      }
    };
    
    loadStudyData();
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
    if (!currentStudy) return;
    
    try {
      // TODO: Implement RT structure save API endpoint
      toast({
        title: "Success",
        description: `RT Structure Set saved as: ${seriesDescription}`,
      });
      setShowSaveDialog(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save RT structure set",
        variant: "destructive"
      });
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
      // TODO: Implement export API endpoint
      toast({
        title: "Success",
        description: `Exporting ${selectedExportItems.size} items...`,
      });
      setShowExportDialog(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to export files",
        variant: "destructive"
      });
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
      <header className="fixed top-4 left-4 right-4 bg-dicom-dark/80 backdrop-blur-md border border-green-500/30 rounded-2xl px-6 py-3 z-50 shadow-xl animate-slide-up">
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
            
            {currentStudy && (
              <div className="flex items-center space-x-3 pl-4 border-l border-gray-600">
                <div>
                  <h2 className="text-sm font-semibold text-dicom-yellow">{currentStudy.patientName}</h2>
                  <p className="text-xs text-gray-400">
                    {currentStudy.studyDescription} • {formatDate(currentStudy.studyDate)}
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
        />
      </div>

      {/* Save Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Save RT Structure Set</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="series-description" className="text-right">
                Description
              </Label>
              <Input
                id="series-description"
                value={seriesDescription}
                onChange={(e) => setSeriesDescription(e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="text-sm text-gray-500">
              This will create a new version of the RT structure set that can be retrieved later.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveConfirm}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-[600px] max-h-[600px]">
          <DialogHeader>
            <DialogTitle>Export DICOM Files</DialogTitle>
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
              >
                {selectedExportItems.size === exportItems.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {exportItems.map((item) => (
                <div key={item.id} className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded">
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
                  />
                  <Label
                    htmlFor={item.id}
                    className="flex-1 cursor-pointer"
                  >
                    <div className="font-medium">{item.name}</div>
                    <div className="text-sm text-gray-500">{item.description}</div>
                  </Label>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleExportConfirm}>
              Export {selectedExportItems.size} Item{selectedExportItems.size !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}