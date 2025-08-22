import { SimplifiedUploader } from '@/components/dicom/simplified-uploader';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';
import { ArrowLeft, Home } from 'lucide-react';

export default function UploadPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      {/* Navigation Bar */}
      <div className="bg-white dark:bg-gray-900 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation('/')}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Patients
              </Button>
            </div>
            
            <h1 className="text-lg font-semibold">
              DICOM Upload Center
            </h1>
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation('/')}
            >
              <Home className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Upload Medical Imaging Files
          </h2>
          <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
            Import DICOM studies quickly and easily
          </p>
        </div>

        {/* Uploader Component */}
        <SimplifiedUploader />

        {/* Instructions */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 shadow-sm border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                <span className="text-2xl">1️⃣</span>
              </div>
              <h3 className="font-semibold">Select Files</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Drag and drop your DICOM files or ZIP archives into the upload area, or click to browse
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 shadow-sm border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                <span className="text-2xl">2️⃣</span>
              </div>
              <h3 className="font-semibold">Automatic Processing</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Files are automatically parsed, validated, and organized by patient and study
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 shadow-sm border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                <span className="text-2xl">3️⃣</span>
              </div>
              <h3 className="font-semibold">Ready to View</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Once imported, you'll be redirected to view the patient's imaging studies
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}