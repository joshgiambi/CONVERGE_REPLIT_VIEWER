/**
 * Loading spinner component for DICOM viewer
 */

interface LoadingSpinnerProps {
  message?: string;
}

export function LoadingSpinner({ message = "Loading..." }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      {message && <p className="mt-4 text-white text-sm">{message}</p>}
    </div>
  );
}