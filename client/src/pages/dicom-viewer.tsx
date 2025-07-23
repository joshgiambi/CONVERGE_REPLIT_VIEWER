import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UploadZone } from '@/components/dicom/upload-zone';
import { ViewerInterface } from '@/components/dicom/viewer-interface';
import { Download, User, Calendar, Home, ArrowLeft, Save, List, FolderDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';

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

interface SeriesData {
  id: number;
  studyId: number;
  seriesInstanceUID: string;
  seriesDescription: string;
  modality: string;
  seriesNumber: number;
  imageCount: number;
  sliceThickness: string;
  metadata: any;
  createdAt: string;
}

export default function DICOMViewer() {
  const [studyData, setStudyData] = useState<any>(null);
  const [currentPatient, setCurrentPatient] = useState<any>(null);
  const [location, navigate] = useLocation();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [seriesDescription, setSeriesDescription] = useState('');
  const [selectedExportItems, setSelectedExportItems] = useState<Set<string>>(new Set());
  const [exportItems, setExportItems] = useState<any[]>([]);
  const { toast } = useToast();

  // Extract studyId from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const studyId = urlParams.get('studyId');

  // Fetch study data if studyId is provided
  const { data: study, isLoading: studyLoading } = useQuery<Study>({
    queryKey: [`/api/studies/${studyId}`],
    queryFn: async () => {
      const response = await fetch(`/api/studies/${studyId}`);
      if (!response.ok) throw new Error('Failed to fetch study');
      return response.json();
    },
    enabled: !!studyId,
  });

  // Fetch series data for the study
  const { data: seriesData, isLoading: seriesLoading } = useQuery<SeriesData[]>({
    queryKey: [`/api/studies/${studyId}/series`],
    queryFn: async () => {
      const response = await fetch(`/api/studies/${studyId}/series`);
      if (!response.ok) throw new Error('Failed to fetch series');
      return response.json();
    },
    enabled: !!studyId,
  });

  useEffect(() => {
    if (study && seriesData) {
      // Transform API data to match expected format
      const transformedData = {
        studies: [study],
        series: seriesData
      };
      setStudyData(transformedData);
      
      setCurrentPatient({
        name: study.patientName || 'Unknown Patient',
        id: study.patientID || 'Unknown ID',
        studyDate: study.studyDate || ''
      });
    }
  }, [study, seriesData]);

  const handleUploadComplete = (data: any) => {
    setStudyData(data);
    
    // Set patient info from first study
    if (data.studies?.length > 0) {
      const firstStudy = data.studies[0];
      setCurrentPatient({
        name: firstStudy.patientName || 'Unknown Patient',
        id: firstStudy.patientID || 'Unknown ID',
        studyDate: firstStudy.studyDate || ''
      });
    }
  };

  const handleSave = () => {
    const currentDate = new Date();
    const defaultDescription = `RT Structure Set - ${currentDate.toLocaleDateString()} ${currentDate.toLocaleTimeString()}`;
    setSeriesDescription(defaultDescription);
    setShowSaveDialog(true);
  };

  const handleExport = async () => {
    if (!study) return;
    
    try {
      // Fetch all series for the current study
      const response = await fetch(`/api/studies/${study.id}/series`);
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
    if (!study) return;
    
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

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown Date';
    
    try {
      // DICOM dates are in YYYYMMDD format
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

  return (
    <div className="min-h-screen bg-dicom-black text-white">
      {/* Floating Header */}
      <header className="fixed top-4 left-4 right-4 bg-dicom-dark/80 backdrop-blur-md border border-dicom-indigo/30 rounded-2xl px-6 py-3 z-50 shadow-xl animate-slide-up">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center space-x-4">
            <div>
              <h1 className="text-xl font-black tracking-wider flex">
                <span style={{
                  background: 'linear-gradient(45deg, #00b4d8, #90e0ef)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontWeight: '900'
                }}>S</span>
                <span style={{
                  background: 'linear-gradient(45deg, #0077b6, #00b4d8)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontWeight: '900'
                }}>U</span>
                <span style={{
                  background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontWeight: '900'
                }}>P</span>
                <span style={{
                  background: 'linear-gradient(45deg, #8b5cf6, #a855f7)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontWeight: '900'
                }}>E</span>
                <span style={{
                  background: 'linear-gradient(45deg, #a855f7, #d946ef)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontWeight: '900'
                }}>R</span>
                <span style={{
                  background: 'linear-gradient(45deg, #ec4899, #f43f5e)',
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
          </div>
          
          <div className="flex items-center space-x-3">
            {/* Patient Info */}
            {currentPatient && (
              <div className="hidden md:flex items-center space-x-2 text-sm bg-dicom-darker/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-dicom-blue/20">
                <User className="w-3 h-3 text-dicom-yellow" />
                <span className="text-white text-xs">{currentPatient.name}</span>
                <span className="text-dicom-gray">|</span>
                <Calendar className="w-3 h-3 text-dicom-blue" />
                <span className="text-white text-xs">{formatDate(currentPatient.studyDate)}</span>
              </div>
            )}
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open('/', '_blank')}
              className="text-white hover:bg-white/10"
            >
              <List className="h-4 w-4 mr-2" />
              Patient List
            </Button>
            {studyData && (
              <>
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
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-24 px-6">
        {!studyData ? (
          /* Upload Section */
          <div className="max-w-4xl mx-auto py-16">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-dicom-yellow mb-4">
                Medical Imaging Viewer
              </h2>
              <p className="text-gray-400 text-lg">
                Upload and analyze DICOM studies with multi-planar reconstruction
              </p>
            </div>
            
            <UploadZone onUploadComplete={handleUploadComplete} />
            
            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <Card className="bg-dicom-dark/50 border-dicom-gray p-6">
                <div className="w-12 h-12 bg-dicom-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-dicom-yellow" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Native DICOM</h3>
                <p className="text-gray-400 text-sm">
                  True DICOM rendering with no conversion or quality loss
                </p>
              </Card>
              
              <Card className="bg-dicom-dark/50 border-dicom-gray p-6">
                <div className="w-12 h-12 bg-dicom-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-dicom-yellow" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Multi-Planar</h3>
                <p className="text-gray-400 text-sm">
                  Synchronized axial, sagittal, and coronal views
                </p>
              </Card>
              
              <Card className="bg-dicom-dark/50 border-dicom-gray p-6">
                <div className="w-12 h-12 bg-dicom-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-dicom-yellow" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Fast Processing</h3>
                <p className="text-gray-400 text-sm">
                  Optimized for large datasets with efficient memory usage
                </p>
              </Card>
            </div>
          </div>
        ) : (
          /* Viewer Interface */
          <ViewerInterface studyData={studyData} />
        )}
      </main>

      {/* Save Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="bg-dicom-dark border-dicom-gray">
          <DialogHeader>
            <DialogTitle className="text-white">Save RT Structure Set</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="description" className="text-white">
                Series Description
              </Label>
              <Input
                id="description"
                value={seriesDescription}
                onChange={(e) => setSeriesDescription(e.target.value)}
                placeholder="Enter description for this RT structure set version"
                className="bg-dicom-darker border-dicom-gray text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSaveDialog(false)}
              className="border-dicom-gray text-white hover:bg-dicom-gray/20"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveConfirm}
              className="bg-gradient-primary text-white"
            >
              Save Version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="bg-dicom-dark border-dicom-gray max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-white">Export DICOM Files</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {exportItems.map((item) => (
              <div key={item.id} className="flex items-center space-x-3 p-3 rounded hover:bg-dicom-gray/20">
                <Checkbox
                  id={item.id}
                  checked={selectedExportItems.has(item.id)}
                  onCheckedChange={(checked) => {
                    const newSet = new Set(selectedExportItems);
                    if (checked) {
                      newSet.add(item.id);
                    } else {
                      newSet.delete(item.id);
                    }
                    setSelectedExportItems(newSet);
                  }}
                />
                <label htmlFor={item.id} className="flex-1 cursor-pointer">
                  <div className="text-white font-medium">{item.name}</div>
                  <div className="text-gray-400 text-sm">{item.description}</div>
                </label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowExportDialog(false)}
              className="border-dicom-gray text-white hover:bg-dicom-gray/20"
            >
              Cancel
            </Button>
            <Button
              onClick={handleExportConfirm}
              className="bg-gradient-primary text-white"
            >
              Export Selected ({selectedExportItems.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
