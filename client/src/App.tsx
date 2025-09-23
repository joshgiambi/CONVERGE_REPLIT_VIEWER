import React from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Viewer from "@/pages/viewer";
import PatientManager from "@/pages/patient-manager";
import FusionTestPage from "@/pages/fusion-test";
import NotFound from "@/pages/not-found";
import MasterDebug from "@/components/global/MasterDebug";

function Router() {
  return (
    <Switch>
      <Route path="/" component={PatientManager} />
      <Route path="/viewer" component={Viewer} />
      <Route path="/dicom-viewer" component={Viewer} />
      <Route path="/enhanced-viewer" component={Viewer} />
      <Route path="/fusion-test" component={FusionTestPage} />
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
        <MasterDebug placement="top-right" />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
