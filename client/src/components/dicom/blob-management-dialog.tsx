/**
 * Blob Management Dialog
 * 
 * Professional UI component for managing and removing disconnected 3D blob volumes
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Target, Trash2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createContourKey, type Blob, type BlobContour } from '@/lib/blob-operations';

interface BlobManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  blobs: Blob[];
  structureId: number;
  structureName: string;
  onDeleteBlobs: (blobIds: number[]) => void;
  onLocalize: (blobId: number, contours: BlobContour[]) => void;
  imageMetadata?: any;
}

export function BlobManagementDialog({
  isOpen,
  onClose,
  blobs,
  structureId,
  structureName,
  onDeleteBlobs,
  onLocalize,
  imageMetadata
}: BlobManagementDialogProps) {
  const { toast } = useToast();
  const [selectedBlobIds, setSelectedBlobIds] = useState<Set<number>>(new Set());
  const [blobList, setBlobList] = useState<Blob[]>(blobs);

  // Auto-select small blobs when dialog opens or blobs change
  useEffect(() => {
    if (blobs.length > 0) {
      setBlobList(blobs);
      
      // Auto-select smallest blobs
      const sorted = [...blobs].sort((a, b) => a.volumeCc - b.volumeCc);
      const largestVolume = sorted[sorted.length - 1].volumeCc;
      const threshold = largestVolume * 0.2;
      
      const autoSelectIds = new Set(
        sorted.filter(b => b.volumeCc < threshold).map(b => b.id)
      );
      
      // If no blobs meet the 20% threshold, select the smallest 80% by count
      if (autoSelectIds.size === 0) {
        const smallBlobCount = Math.floor(sorted.length * 0.8);
        for (let i = 0; i < smallBlobCount; i++) {
          autoSelectIds.add(sorted[i].id);
        }
      }
      
      setSelectedBlobIds(autoSelectIds);
      console.log(`Auto-selected ${autoSelectIds.size} small blobs out of ${blobs.length} total`);
    }
  }, [blobs]);

  if (!isOpen) return null;

  const handleSelectSmallBlobs = () => {
    // Sort by volume
    const sorted = [...blobList].sort((a, b) => a.volumeCc - b.volumeCc);
    const largestVolume = sorted[sorted.length - 1].volumeCc;
    const threshold = largestVolume * 0.2;
    
    const autoSelectIds = new Set(
      sorted.filter(b => b.volumeCc < threshold).map(b => b.id)
    );
    
    // If no blobs meet the 20% threshold, select the smallest 80% by count
    if (autoSelectIds.size === 0) {
      const smallBlobCount = Math.floor(sorted.length * 0.8);
      for (let i = 0; i < smallBlobCount; i++) {
        autoSelectIds.add(sorted[i].id);
      }
    }
    
    setSelectedBlobIds(autoSelectIds);
  };

  const handleDeleteSingleBlob = (blobId: number) => {
    onDeleteBlobs([blobId]);
    
    // Update local list
    const updated = blobList.filter(b => b.id !== blobId);
    setBlobList(updated);
    
    // Remove from selection
    const next = new Set(selectedBlobIds);
    next.delete(blobId);
    setSelectedBlobIds(next);
    
    if (updated.length === 0) {
      onClose();
      toast({ title: "All blobs removed", description: "No more blobs remaining" });
    } else {
      toast({ title: "Blob deleted", description: `Blob ${blobId} removed` });
    }
  };

  const handleDeleteSelected = () => {
    if (selectedBlobIds.size === 0) return;
    
    const idsToDelete = Array.from(selectedBlobIds);
    onDeleteBlobs(idsToDelete);
    
    toast({ 
      title: "Blobs removed", 
      description: `Deleted ${selectedBlobIds.size} blob${selectedBlobIds.size !== 1 ? 's' : ''}`
    });
    
    onClose();
  };

  const totalSelectedVolume = blobList
    .filter(b => selectedBlobIds.has(b.id))
    .reduce((sum, b) => sum + b.volumeCc, 0);

  return (
    <>
      {/* Spotlight overlay - crisp edges, no animation */}
      <div 
        className="fixed inset-0 z-40 pointer-events-none"
        style={{
          background: `
            radial-gradient(circle 400px at 65% 50%, 
              rgba(0, 0, 0, 0) 0%, 
              rgba(0, 0, 0, 0) 94%,
              rgba(147, 51, 234, 0.5) 94%,
              rgba(168, 85, 247, 0.7) 94.5%,
              rgba(147, 51, 234, 0.5) 95%,
              rgba(0, 0, 0, 0.6) 97%,
              rgba(0, 0, 0, 0.85) 100%
            )
          `
        }}
      />
      
      {/* Blob management panel - matches Advanced Margin Tool style */}
      <div className="fixed top-1/2 -translate-y-1/2 left-8 z-50">
        <div className="backdrop-blur-md border border-purple-500/60 rounded-xl px-4 py-3 shadow-2xl bg-gray-900/90 w-[360px] max-h-[75vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <span className="text-white text-sm font-medium">Blob Management</span>
              <span className="text-white/50 text-xs">({blobList.length} detected)</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg"
            >
              <X size={14} />
            </Button>
          </div>
          
          {/* Selection helper buttons */}
          <div className="flex gap-2 mb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectSmallBlobs}
              className="flex-1 h-7 px-3 bg-white/10 border-2 border-white/30 text-white hover:bg-white/20 rounded-lg backdrop-blur-sm shadow-sm text-xs"
            >
              Select Small
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedBlobIds(new Set())}
              className="flex-1 h-7 px-3 bg-white/10 border-2 border-white/30 text-white hover:bg-white/20 rounded-lg backdrop-blur-sm shadow-sm text-xs"
            >
              Clear
            </Button>
          </div>

          {/* Blob list */}
          <div className="space-y-1.5">
            {blobList.map((b) => (
              <div 
                key={b.id} 
                className="flex items-center gap-2 px-2 py-2 rounded-lg bg-white/5 border border-white/20 hover:bg-white/10 transition-all"
              >
                <input
                  type="checkbox"
                  checked={selectedBlobIds.has(b.id)}
                  onChange={(e) => {
                    const next = new Set(selectedBlobIds);
                    if (e.target.checked) next.add(b.id); else next.delete(b.id);
                    setSelectedBlobIds(next);
                  }}
                  className="w-4 h-4 cursor-pointer"
                />
                <span className="text-sm text-white flex-1">
                  <span className="font-medium">Blob {b.id}</span>
                  <span className="text-white/50 text-xs ml-2">{b.volumeCc.toFixed(2)} cc</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onLocalize(b.id, b.contours)}
                  className="h-6 px-2 text-xs text-blue-300 hover:text-blue-200 hover:bg-blue-900/20 rounded"
                  title="Navigate to this blob"
                >
                  <Target className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteSingleBlob(b.id)}
                  className="h-6 px-2 text-xs text-red-300 hover:text-red-200 hover:bg-red-900/20 rounded"
                  title="Delete this blob"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            {blobList.length === 0 && (
              <div className="text-xs text-white/40 text-center py-8">No blobs to display</div>
            )}
          </div>
          
          {/* Selection summary */}
          {selectedBlobIds.size > 0 && (
            <div className="mt-3 px-3 py-2 bg-purple-900/20 border border-purple-500/40 rounded-lg text-xs text-purple-200">
              <span className="font-medium">{selectedBlobIds.size}</span> blob{selectedBlobIds.size !== 1 ? 's' : ''} selected · 
              <span className="text-purple-300"> {totalSelectedVolume.toFixed(2)} cc</span>
            </div>
          )}
          
          {/* Separator */}
          <div className="my-3 h-px bg-white/20" />
          
          {/* Footer actions */}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="h-7 px-3 bg-white/10 border-2 border-white/30 text-white hover:bg-white/20 rounded-lg backdrop-blur-sm shadow-sm text-xs"
            >
              Close
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={selectedBlobIds.size === 0}
              onClick={handleDeleteSelected}
              className="h-7 px-3 bg-red-600/80 border-2 border-red-500/60 text-white hover:bg-red-700/80 rounded-lg backdrop-blur-sm shadow-sm text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete Selected ({selectedBlobIds.size})
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

