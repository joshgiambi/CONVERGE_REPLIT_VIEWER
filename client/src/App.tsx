import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DICOMViewer from "@/pages/dicom-viewer";
import PatientManager from "@/pages/patient-manager-clean";
import NotFound from "@/pages/not-found";

function RedirectComponent() {
  const [, setLocation] = useLocation();
  setLocation('/patients-new');
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={RedirectComponent} />
      <Route path="/patients-new" component={PatientManager} />
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
