/**
 * Error display component for DICOM viewer
 */

interface ErrorDisplayProps {
  error: { message: string } | string;
  onRetry?: () => void;
}

export function ErrorDisplay({ error, onRetry }: ErrorDisplayProps) {
  const message = typeof error === 'string' ? error : error.message;
  
  return (
    <div className="flex flex-col items-center justify-center h-full text-white">
      <div className="text-red-400 mb-4">
        <span className="text-lg">⚠️</span>
      </div>
      <p className="text-sm mb-4 text-center">{message}</p>
      {onRetry && (
        <button 
          onClick={onRetry}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Retry
        </button>
      )}
    </div>
  );
}