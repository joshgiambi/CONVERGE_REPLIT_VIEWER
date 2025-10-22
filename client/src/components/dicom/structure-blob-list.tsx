/**
 * Structure Blob List - Expandable blob viewer in sidebar
 * 
 * Shows nested list of blobs under a structure with actions:
 * - Localize: Navigate to blob
 * - Delete: Remove blob
 * - Separate: Create new structure
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Target, Trash2, GitBranch, SplitSquareHorizontal } from 'lucide-react';
import type { Blob, BlobContour } from '@/lib/blob-operations';

interface StructureBlobListProps {
  structureId: number;
  structureName: string;
  blobs: Blob[];
  onLocalize: (blobId: number, contours: BlobContour[]) => void;
  onDelete: (blobId: number) => void;
  onSeparate: (blobId: number) => void;
}

export function StructureBlobList({
  structureId,
  structureName,
  blobs,
  onLocalize,
  onDelete,
  onSeparate
}: StructureBlobListProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (blobs.length <= 1) {
    return null; // Don't show if only 1 blob
  }

  return (
    <div className="ml-6 mt-1">
      {/* Blob toggle button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsExpanded(!isExpanded)}
        className="h-6 px-2 text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-900/20 w-full justify-start"
      >
        {isExpanded ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
        <SplitSquareHorizontal className="w-3 h-3 mr-1" />
        <span>{blobs.length} Blobs Detected</span>
      </Button>

      {/* Expanded blob list */}
      {isExpanded && (
        <div className="ml-4 mt-1 space-y-1 border-l-2 border-purple-500/30 pl-2">
          {blobs.map((blob) => (
            <div
              key={blob.id}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-gray-800/30 border border-gray-700/50 hover:bg-gray-800/50 transition-all"
            >
              <span className="text-xs text-gray-300 flex-1">
                <span className="font-medium text-purple-300">Blob {blob.id}</span>
                <span className="text-gray-500 mx-1">·</span>
                <span className="text-gray-400">{blob.volumeCc.toFixed(2)} cc</span>
              </span>
              
              {/* Localize button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onLocalize(blob.id, blob.contours)}
                className="h-5 w-5 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20"
                title="Locate this blob"
              >
                <Target className="w-3 h-3" />
              </Button>
              
              {/* Separate button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSeparate(blob.id)}
                className="h-5 w-5 p-0 text-green-400 hover:text-green-300 hover:bg-green-900/20"
                title="Separate into new structure"
              >
                <GitBranch className="w-3 h-3" />
              </Button>
              
              {/* Delete button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(blob.id)}
                className="h-5 w-5 p-0 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                title="Delete this blob"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

