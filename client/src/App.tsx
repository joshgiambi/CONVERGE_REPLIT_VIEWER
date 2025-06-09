import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DICOMViewer from "@/pages/dicom-viewer";
import PatientManager from "@/pages/patient-manager-clean";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={PatientManager} />
      <Route path="/new" component={PatientManager} />
      <Route path="/patients" component={PatientManager} />
      <Route path="/dicom-viewer" component={DICOMViewer} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <div key={`app-${Date.now()}-${Math.random()}`}>
          <Router />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
