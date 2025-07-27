import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Keyboard, Edit2, Plus, X, Check, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface Shortcut {
  id: number;
  category: string;
  action: string;
  description: string;
  keys: string;
  isCustom: boolean;
  isActive: boolean;
}

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editKeys, setEditKeys] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newShortcut, setNewShortcut] = useState({
    category: 'Navigation',
    action: '',
    description: '',
    keys: ''
  });

  // Fetch shortcuts from database
  const { data: shortcuts = [], isLoading } = useQuery<Shortcut[]>({
    queryKey: ['/api/shortcuts'],
    enabled: open
  });

  // Initialize default shortcuts if none exist
  const initializeMutation = useMutation({
    mutationFn: () => apiRequest('/api/shortcuts/initialize', 'POST'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/shortcuts'] });
      toast({
        title: 'Shortcuts Initialized',
        description: 'Default shortcuts have been loaded.'
      });
    }
  });

  // Update shortcut mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, keys }: { id: number; keys: string }) => 
      apiRequest(`/api/shortcuts/${id}`, 'PUT', { keys }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/shortcuts'] });
      setEditingId(null);
      toast({
        title: 'Shortcut Updated',
        description: 'The keyboard shortcut has been updated.'
      });
    }
  });

  // Create new shortcut mutation
  const createMutation = useMutation({
    mutationFn: (data: typeof newShortcut) => 
      apiRequest('/api/shortcuts', 'POST', { ...data, isCustom: true, isActive: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/shortcuts'] });
      setIsAddingNew(false);
      setNewShortcut({ category: 'Navigation', action: '', description: '', keys: '' });
      toast({
        title: 'Shortcut Created',
        description: 'Your custom shortcut has been added.'
      });
    }
  });

  // Initialize shortcuts on first open if none exist
  useEffect(() => {
    if (open && shortcuts.length === 0 && !isLoading && !initializeMutation.isPending) {
      initializeMutation.mutate();
    }
  }, [open, shortcuts.length, isLoading, initializeMutation]);

  // Delete shortcut mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/shortcuts/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/shortcuts'] });
      toast({
        title: 'Shortcut Deleted',
        description: 'The shortcut has been removed.'
      });
    }
  });

  // Group shortcuts by category
  const categories = ['Navigation', 'Tools', 'View', 'Edit', 'Window/Level', 'Pan/Zoom', 'AI Features'];
  const shortcutsByCategory = categories.reduce((acc, category) => {
    acc[category] = shortcuts.filter(s => s.category === category);
    return acc;
  }, {} as Record<string, Shortcut[]>);

  // Initialize shortcuts if none exist
  useEffect(() => {
    if (open && shortcuts.length === 0 && !isLoading) {
      initializeMutation.mutate();
    }
  }, [open, shortcuts.length, isLoading]);

  const handleEditKeys = (shortcut: Shortcut) => {
    setEditingId(shortcut.id);
    setEditKeys(shortcut.keys);
  };

  const handleSaveKeys = (id: number) => {
    updateMutation.mutate({ id, keys: editKeys });
  };

  const handleCreateShortcut = () => {
    if (!newShortcut.action || !newShortcut.description || !newShortcut.keys) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all fields.',
        variant: 'destructive'
      });
      return;
    }
    createMutation.mutate(newShortcut);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            View and customize keyboard shortcuts for the DICOM viewer
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : (
          <Tabs defaultValue="Navigation" className="mt-4">
            <TabsList className="grid grid-cols-7 w-full bg-gray-800">
              {categories.map(category => (
                <TabsTrigger 
                  key={category} 
                  value={category}
                  className="data-[state=active]:bg-gray-700 data-[state=active]:text-white"
                >
                  {category}
                </TabsTrigger>
              ))}
            </TabsList>

            {categories.map(category => (
              <TabsContent key={category} value={category} className="mt-4 space-y-2 max-h-[50vh] overflow-y-auto">
                {shortcutsByCategory[category]?.map(shortcut => (
                  <div 
                    key={shortcut.id} 
                    className="flex items-center justify-between p-3 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{shortcut.description}</div>
                      <div className="text-sm text-gray-400">Action: {shortcut.action}</div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {editingId === shortcut.id ? (
                        <>
                          <Input
                            value={editKeys}
                            onChange={(e) => setEditKeys(e.target.value)}
                            className="w-32 h-8 bg-gray-700 border-gray-600"
                            placeholder="e.g., Ctrl+Z"
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleSaveKeys(shortcut.id)}
                            className="h-8 w-8 p-0"
                          >
                            <Check className="h-4 w-4 text-green-400" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                            className="h-8 w-8 p-0"
                          >
                            <X className="h-4 w-4 text-red-400" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Badge variant="secondary" className="bg-gray-700">
                            {shortcut.keys}
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEditKeys(shortcut)}
                            className="h-8 w-8 p-0"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          {shortcut.isCustom && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteMutation.mutate(shortcut.id)}
                              className="h-8 w-8 p-0"
                            >
                              <X className="h-4 w-4 text-red-400" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {/* Add new shortcut form for current category */}
                {isAddingNew && newShortcut.category === category && (
                  <div className="p-4 bg-gray-800 rounded-lg border border-gray-600">
                    <div className="space-y-3">
                      <div>
                        <Label>Action ID</Label>
                        <Input
                          value={newShortcut.action}
                          onChange={(e) => setNewShortcut({ ...newShortcut, action: e.target.value })}
                          placeholder="e.g., quick_save"
                          className="bg-gray-700 border-gray-600"
                        />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Input
                          value={newShortcut.description}
                          onChange={(e) => setNewShortcut({ ...newShortcut, description: e.target.value })}
                          placeholder="e.g., Quick save current state"
                          className="bg-gray-700 border-gray-600"
                        />
                      </div>
                      <div>
                        <Label>Keys</Label>
                        <Input
                          value={newShortcut.keys}
                          onChange={(e) => setNewShortcut({ ...newShortcut, keys: e.target.value })}
                          placeholder="e.g., Ctrl+S"
                          className="bg-gray-700 border-gray-600"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={handleCreateShortcut} size="sm">
                          <Check className="h-4 w-4 mr-1" />
                          Create
                        </Button>
                        <Button 
                          onClick={() => setIsAddingNew(false)} 
                          size="sm" 
                          variant="ghost"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Add new button for current category */}
                {!isAddingNew && (
                  <Button
                    onClick={() => {
                      setIsAddingNew(true);
                      setNewShortcut({ ...newShortcut, category });
                    }}
                    variant="outline"
                    size="sm"
                    className="w-full border-gray-600 hover:bg-gray-700"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Custom Shortcut
                  </Button>
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}