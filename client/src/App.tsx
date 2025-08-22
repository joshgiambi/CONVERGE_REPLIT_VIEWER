import React from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Viewer from "@/pages/viewer";
import PatientManager from "@/pages/patient-manager";
import NotFound from "@/pages/not-found";
import UploadPage from "@/pages/upload";

function Router() {
  return (
    <Switch>
      <Route path="/" component={PatientManager} />
      <Route path="/upload" component={UploadPage} />
      <Route path="/viewer" component={Viewer} />
      <Route path="/dicom-viewer" component={Viewer} />
      <Route path="/enhanced-viewer" component={Viewer} />
      <Route path="/patients/:id/studies" component={PatientManager} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
