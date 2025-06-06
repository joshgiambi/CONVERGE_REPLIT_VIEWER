import { AlertTriangle, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRetry?: () => void;
  error: {
    title: string;
    message: string;
    details?: string;
  };
}

export function ErrorModal({ isOpen, onClose, onRetry, error }: ErrorModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-dicom-dark border-red-500 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center text-red-500">
            <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center mr-3">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            {error.title}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <p className="text-gray-300">
            {error.message}
          </p>
          
          {error.details && (
            <div className="bg-dicom-darker rounded-lg p-3">
              <p className="text-xs text-gray-400 font-mono">
                {error.details}
              </p>
            </div>
          )}
          
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              variant="outline"
              onClick={onClose}
              className="border-dicom-gray hover:bg-dicom-gray"
            >
              <X className="w-4 h-4 mr-2" />
              Close
            </Button>
            
            {onRetry && (
              <Button
                onClick={onRetry}
                className="bg-dicom-yellow text-black hover:bg-dicom-yellow/90"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
