import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Copy, CheckCircle2, AlertCircle, Info, Database } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface RegistrationRelationship {
  id: number;
  primarySeriesId: number;
  secondarySeriesId: number;
  registrationId: string | null;
  registrationFilePath: string | null;
  relationshipType: string;
  registrationMethod: string;
  confidenceScore: number;
  geometricValidationPassed: boolean;
  primaryModality?: string;
  secondaryModality?: string;
  primaryDescription?: string;
  secondaryDescription?: string;
}

interface FusionDebugDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studyId?: number;
  patientId?: number;
}

export function FusionDebugDialog({ open, onOpenChange, studyId, patientId }: FusionDebugDialogProps) {
  const [relationships, setRelationships] = useState<RegistrationRelationship[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && studyId) {
      fetchRelationships();
    }
  }, [open, studyId]);

  const fetchRelationships = async () => {
    if (!studyId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/studies/${studyId}/registration-relationships`);
      if (!response.ok) {
        throw new Error(`Failed to fetch relationships: ${response.statusText}`);
      }
      const data = await response.json();
      setRelationships(data.relationships || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch registration data');
      console.error('Error fetching registration relationships:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyAll = async () => {
    const summary = generateSummary();
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      toast({
        title: 'Copied to clipboard',
        description: 'Fusion debug information has been copied.',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({
        title: 'Failed to copy',
        description: 'Could not copy to clipboard.',
        variant: 'destructive',
      });
    }
  };

  const generateSummary = () => {
    const lines: string[] = [];
    lines.push('=== FUSION DEBUG REPORT ===');
    lines.push('');
    lines.push(`Study ID: ${studyId || 'N/A'}`);
    lines.push(`Patient ID: ${patientId || 'N/A'}`);
    lines.push(`Total Relationships: ${relationships.length}`);
    lines.push('');

    if (relationships.length === 0) {
      lines.push('No registration relationships found.');
      lines.push('This could mean:');
      lines.push('  - No REG DICOM files were uploaded');
      lines.push('  - Series do not share Frame of Reference UIDs');
      lines.push('  - Registration processing has not completed yet');
    } else {
      lines.push('=== HIERARCHICAL RELATIONSHIPS ===');
      lines.push('');

      // Group by primary series
      const byPrimary = new Map<number, RegistrationRelationship[]>();
      relationships.forEach(rel => {
        if (!byPrimary.has(rel.primarySeriesId)) {
          byPrimary.set(rel.primarySeriesId, []);
        }
        byPrimary.get(rel.primarySeriesId)!.push(rel);
      });

      byPrimary.forEach((rels, primaryId) => {
        const first = rels[0];
        lines.push(`PRIMARY Series ${primaryId}`);
        lines.push(`  Modality: ${first.primaryModality || 'Unknown'}`);
        lines.push(`  Description: ${first.primaryDescription || 'N/A'}`);
        lines.push(`  Secondary Series (${rels.length}):`);

        rels.forEach((rel, idx) => {
          lines.push(`    ${idx + 1}. Series ${rel.secondarySeriesId} (${rel.secondaryModality || 'Unknown'})`);
          lines.push(`       Description: ${rel.secondaryDescription || 'N/A'}`);
          lines.push(`       Method: ${rel.registrationMethod}`);
          lines.push(`       Type: ${rel.relationshipType}`);
          lines.push(`       Confidence: ${(rel.confidenceScore * 100).toFixed(1)}%`);
          lines.push(`       Validation: ${rel.geometricValidationPassed ? 'PASSED' : 'FAILED'}`);
          if (rel.registrationFilePath) {
            const fileName = rel.registrationFilePath.split('/').pop() || 'N/A';
            lines.push(`       REG File: ${fileName}`);
          }
          if (rel.registrationId) {
            lines.push(`       Registration ID: ${rel.registrationId}`);
          }
          lines.push('');
        });
      });
    }

    lines.push('');
    lines.push('=== REGISTRATION METHODS ===');
    const methodCounts = relationships.reduce((acc, rel) => {
      acc[rel.registrationMethod] = (acc[rel.registrationMethod] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    if (Object.keys(methodCounts).length === 0) {
      lines.push('No registration methods found');
    } else {
      Object.entries(methodCounts).forEach(([method, count]) => {
        lines.push(`  ${method}: ${count}`);
      });
    }

    return lines.join('\n');
  };

  const renderRelationshipTree = () => {
    // Group by primary series
    const byPrimary = new Map<number, RegistrationRelationship[]>();
    relationships.forEach(rel => {
      if (!byPrimary.has(rel.primarySeriesId)) {
        byPrimary.set(rel.primarySeriesId, []);
      }
      byPrimary.get(rel.primarySeriesId)!.push(rel);
    });

    return (
      <div className="space-y-4">
        {Array.from(byPrimary.entries()).map(([primaryId, rels]) => {
          const first = rels[0];
          return (
            <div key={primaryId} className="border border-slate-700 rounded-lg p-4 bg-slate-900/30">
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="outline" className="bg-cyan-900/40 border-cyan-700/50 text-cyan-200">
                  PRIMARY
                </Badge>
                <span className="text-sm font-semibold text-slate-200">
                  Series {primaryId} · {first.primaryModality || 'Unknown'}
                </span>
              </div>

              {first.primaryDescription && (
                <p className="text-xs text-slate-400 mb-3">{first.primaryDescription}</p>
              )}

              <div className="space-y-2 ml-4 border-l-2 border-slate-700 pl-4">
                {rels.map((rel, idx) => (
                  <div key={idx} className="bg-slate-800/40 rounded p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-purple-900/40 border-purple-700/50 text-purple-200 text-xs">
                        SECONDARY
                      </Badge>
                      <span className="text-sm font-medium text-slate-200">
                        Series {rel.secondarySeriesId} · {rel.secondaryModality || 'Unknown'}
                      </span>
                    </div>

                    {rel.secondaryDescription && (
                      <p className="text-xs text-slate-400">{rel.secondaryDescription}</p>
                    )}

                    <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                      <div>
                        <span className="text-slate-500">Method:</span>
                        <span className="text-slate-300 ml-1">{rel.registrationMethod}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Type:</span>
                        <span className="text-slate-300 ml-1">{rel.relationshipType}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Confidence:</span>
                        <span className="text-slate-300 ml-1">{(rel.confidenceScore * 100).toFixed(1)}%</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Validation:</span>
                        <span className={`ml-1 ${rel.geometricValidationPassed ? 'text-emerald-300' : 'text-amber-300'}`}>
                          {rel.geometricValidationPassed ? 'PASSED' : 'FAILED'}
                        </span>
                      </div>
                    </div>

                    {rel.registrationFilePath && (
                      <div className="text-xs mt-2">
                        <span className="text-slate-500">REG File:</span>
                        <span className="text-slate-300 ml-1 font-mono">
                          {rel.registrationFilePath.split('/').pop()}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderStatistics = () => {
    const methodCounts = relationships.reduce((acc, rel) => {
      acc[rel.registrationMethod] = (acc[rel.registrationMethod] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const typeCounts = relationships.reduce((acc, rel) => {
      acc[rel.relationshipType] = (acc[rel.relationshipType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const avgConfidence = relationships.length > 0
      ? relationships.reduce((sum, rel) => sum + rel.confidenceScore, 0) / relationships.length
      : 0;

    const validationPassed = relationships.filter(r => r.geometricValidationPassed).length;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-slate-700 rounded-lg p-4 bg-slate-900/30">
            <div className="text-sm font-semibold text-slate-300 mb-2">Total Relationships</div>
            <div className="text-3xl font-bold text-cyan-300">{relationships.length}</div>
          </div>

          <div className="border border-slate-700 rounded-lg p-4 bg-slate-900/30">
            <div className="text-sm font-semibold text-slate-300 mb-2">Avg Confidence</div>
            <div className="text-3xl font-bold text-emerald-300">{(avgConfidence * 100).toFixed(1)}%</div>
          </div>

          <div className="border border-slate-700 rounded-lg p-4 bg-slate-900/30">
            <div className="text-sm font-semibold text-slate-300 mb-2">Validation Passed</div>
            <div className="text-3xl font-bold text-purple-300">{validationPassed}/{relationships.length}</div>
          </div>

          <div className="border border-slate-700 rounded-lg p-4 bg-slate-900/30">
            <div className="text-sm font-semibold text-slate-300 mb-2">Unique Primaries</div>
            <div className="text-3xl font-bold text-amber-300">
              {new Set(relationships.map(r => r.primarySeriesId)).size}
            </div>
          </div>
        </div>

        <div className="border border-slate-700 rounded-lg p-4 bg-slate-900/30">
          <div className="text-sm font-semibold text-slate-300 mb-3">Registration Methods</div>
          <div className="space-y-2">
            {Object.entries(methodCounts).map(([method, count]) => (
              <div key={method} className="flex justify-between items-center">
                <span className="text-sm text-slate-400">{method}</span>
                <Badge variant="outline" className="bg-slate-800/60 border-slate-600/50">
                  {count}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-slate-700 rounded-lg p-4 bg-slate-900/30">
          <div className="text-sm font-semibold text-slate-300 mb-3">Relationship Types</div>
          <div className="space-y-2">
            {Object.entries(typeCounts).map(([type, count]) => (
              <div key={type} className="flex justify-between items-center">
                <span className="text-sm text-slate-400">{type}</span>
                <Badge variant="outline" className="bg-slate-800/60 border-slate-600/50">
                  {count}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col bg-slate-900 text-slate-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-cyan-400" />
            Fusion Debug Information
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Registration relationships and fusion system diagnostics
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-sm text-slate-400">Loading registration data...</div>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-4 bg-amber-900/30 border border-amber-700/60 rounded-lg text-amber-200">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          ) : relationships.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-3">
              <Info className="h-12 w-12 text-slate-600" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-slate-300">No registration relationships found</p>
                <p className="text-xs text-slate-500 max-w-md">
                  This study does not have any registered series pairs. Upload REG DICOM files or ensure
                  series share Frame of Reference UIDs for automatic fusion.
                </p>
              </div>
            </div>
          ) : (
            <Tabs defaultValue="tree" className="w-full">
              <TabsList className="grid w-full grid-cols-3 bg-slate-800">
                <TabsTrigger value="tree">Hierarchy</TabsTrigger>
                <TabsTrigger value="stats">Statistics</TabsTrigger>
                <TabsTrigger value="raw">Raw Data</TabsTrigger>
              </TabsList>

              <TabsContent value="tree" className="space-y-4 mt-4">
                {renderRelationshipTree()}
              </TabsContent>

              <TabsContent value="stats" className="space-y-4 mt-4">
                {renderStatistics()}
              </TabsContent>

              <TabsContent value="raw" className="space-y-4 mt-4">
                <div className="border border-slate-700 rounded-lg p-4 bg-slate-900/30">
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono overflow-x-auto max-h-[400px] overflow-y-auto">
                    {generateSummary()}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {!loading && !error && (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                <span>Last updated: {new Date().toLocaleTimeString()}</span>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyAll}
              disabled={loading || relationships.length === 0}
              className="bg-slate-800 hover:bg-slate-700 border-slate-600"
            >
              {copied ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Report
                </>
              )}
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}