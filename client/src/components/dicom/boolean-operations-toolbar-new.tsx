import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { X, Play, Info, Plus, Eye, Undo, Redo, Eraser, Trash2 } from 'lucide-react';

interface BooleanOperationsToolbarProps {
  isVisible: boolean;
  onClose: () => void;
  availableStructures: string[];
  onExecuteOperation: (expression: string, newStructure?: {
    createNewStructure: boolean;
    name: string;
    color: string;
  }) => void;
}

export function BooleanOperationsToolbar({
  isVisible,
  onClose,
  availableStructures,
  onExecuteOperation
}: BooleanOperationsToolbarProps) {
  const [expression, setExpression] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [livePreview, setLivePreview] = useState(false);
  const [showNewStructurePanel, setShowNewStructurePanel] = useState(false);
  const [newStructureName, setNewStructureName] = useState('');
  const [newStructureColor, setNewStructureColor] = useState('#3B82F6');
  const inputRef = useRef<HTMLInputElement>(null);
  const [showPillView, setShowPillView] = useState(false);
  const [syntaxErrors, setSyntaxErrors] = useState<string[]>([]);

  // Get structure color from RT structures (mock for now - should come from RT structures data)
  const getStructureColor = (structureName: string): string => {
    // Mock colors for demo - in real implementation, this would come from RT structures
    const colorMap: { [key: string]: string } = {
      'BODY': '#80FFFF',
      'SpinalCord': '#FF0000',
      'Brain': '#FFB6C1',
      'BrainStem': '#FF69B4',
      'Parotid_R': '#00FF00',
      'Parotid_L': '#00FF00',
      'Mandible': '#FFFF00',
      'Larynx': '#FFA500',
      'Thyroid': '#800080'
    };
    return colorMap[structureName] || '#3B82F6';
  };

  // Validate expression syntax and detect unknown structures
  const validateExpression = (expr: string) => {
    const errors: string[] = [];
    
    if (!expr.trim()) {
      setSyntaxErrors([]);
      return;
    }

    // Extract potential structure names (letters, numbers, underscores)
    const potentialStructures = expr.match(/[A-Za-z][A-Za-z0-9_#-]*/g) || [];
    
    // Check for unknown structures
    const unknownStructures = potentialStructures.filter(name => {
      // Skip operators and keywords
      if (['and', 'or', 'not', 'true', 'false'].includes(name.toLowerCase())) return false;
      return !availableStructures.some(s => s.toLowerCase() === name.toLowerCase());
    });

    if (unknownStructures.length > 0) {
      errors.push(...unknownStructures);
    }

    setSyntaxErrors(errors);
  };
  
  // Parse expression to identify structure names and operators with syntax highlighting
  const renderExpressionWithPills = () => {
    if (!expression) return null;
    
    // Create a regex pattern that captures both valid structures and potential structure names
    const allStructurePattern = availableStructures
      .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    
    // Pattern for potential structure names (alphanumeric + underscore + dash + hash)
    const potentialStructurePattern = '[A-Za-z][A-Za-z0-9_#-]*';
    
    // Combine patterns
    const combinedPattern = allStructurePattern 
      ? `(${allStructurePattern}|${potentialStructurePattern}|[∪∩⊕\\-()\\s=]+)`
      : `(${potentialStructurePattern}|[∪∩⊕\\-()\\s=]+)`;
    
    const regex = new RegExp(combinedPattern, 'gi');
    const parts = expression.split(regex).filter(part => part && part.trim());
    
    return (
      <div className="flex items-center flex-wrap gap-1">
        {parts.map((part, index) => {
          const trimmedPart = part.trim();
          if (!trimmedPart) return null;
          
          // Check if this part is a valid structure name
          const isValidStructure = availableStructures.some(
            s => s.toLowerCase() === trimmedPart.toLowerCase()
          );
          
          // Check if this looks like a structure name but isn't valid
          const looksLikeStructure = /^[A-Za-z][A-Za-z0-9_#-]*$/.test(trimmedPart) && 
                                   !['and', 'or', 'not', 'true', 'false'].includes(trimmedPart.toLowerCase());
          
          const isUnknownStructure = looksLikeStructure && !isValidStructure;
          
          if (isValidStructure) {
            const color = getStructureColor(trimmedPart);
            return (
              <span
                key={index}
                className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold underline border"
                style={{ 
                  backgroundColor: color + '20',
                  borderColor: color + '80',
                  color: color
                }}
              >
                {trimmedPart}
              </span>
            );
          } else if (isUnknownStructure) {
            return (
              <span
                key={index}
                className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-red-900/50 text-red-300 border border-red-500/70 animate-pulse"
                title={`Unknown structure: ${trimmedPart}`}
              >
                {trimmedPart}
              </span>
            );
          } else if (['∪', '∩', '⊕', '-'].includes(trimmedPart)) {
            // Render operators with styling
            return (
              <span key={index} className="text-yellow-400 font-bold px-1">
                {trimmedPart}
              </span>
            );
          } else if (trimmedPart === '=') {
            return (
              <span key={index} className="text-purple-400 font-bold px-1">
                {trimmedPart}
              </span>
            );
          } else if (['(', ')'].includes(trimmedPart)) {
            return (
              <span key={index} className="text-gray-300 font-medium px-1">
                {trimmedPart}
              </span>
            );
          } else {
            // Render other text (spaces, etc)
            return <span key={index} className="text-white">{trimmedPart}</span>;
          }
        })}
      </div>
    );
  };

  // Validate expression whenever it changes
  useEffect(() => {
    validateExpression(expression);
  }, [expression, availableStructures]);

  // Auto-complete logic - works within brackets and parentheses
  useEffect(() => {
    if (expression.length > 0 && inputRef.current) {
      const cursorPos = inputRef.current.selectionStart || 0;
      const textBeforeCursor = expression.slice(0, cursorPos);
      
      // Find the last word being typed (including within brackets)
      const lastWord = textBeforeCursor.match(/[A-Za-z_][A-Za-z0-9_\-]*$/)?.[0] || '';
      
      if (lastWord.length >= 1) {
        const filtered = availableStructures.filter(structure =>
          structure.toLowerCase().includes(lastWord.toLowerCase())
        );
        setSuggestions(filtered.slice(0, 5));
        setShowSuggestions(filtered.length > 0);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  }, [expression, availableStructures]);

  const insertText = (text: string) => {
    if (inputRef.current) {
      const start = inputRef.current.selectionStart || 0;
      const end = inputRef.current.selectionEnd || 0;
      const newValue = expression.slice(0, start) + text + expression.slice(end);
      setExpression(newValue);
      
      setTimeout(() => {
        if (inputRef.current) {
          const newPosition = start + text.length;
          inputRef.current.setSelectionRange(newPosition, newPosition);
          inputRef.current.focus();
        }
      }, 0);
    }
  };

  const insertStructure = (structureName: string) => {
    if (!inputRef.current) return;
    
    const cursorPos = inputRef.current.selectionStart || 0;
    const textBeforeCursor = expression.slice(0, cursorPos);
    const textAfterCursor = expression.slice(cursorPos);
    
    // Find the last word being typed (including within brackets)
    const lastWordMatch = textBeforeCursor.match(/[A-Za-z_][A-Za-z0-9_\-]*$/);
    
    if (lastWordMatch) {
      // Replace the partial word with the selected structure
      const newExpression = textBeforeCursor.slice(0, lastWordMatch.index) + 
                           structureName + 
                           textAfterCursor;
      setExpression(newExpression);
      
      // Set cursor position after the inserted structure name
      setTimeout(() => {
        if (inputRef.current) {
          const newPos = (lastWordMatch.index || 0) + structureName.length;
          inputRef.current.setSelectionRange(newPos, newPos);
          inputRef.current.focus();
        }
      }, 0);
    } else {
      // Just insert at cursor position
      insertText(structureName);
    }
    setShowSuggestions(false);
  };

  const handleExecute = () => {
    if (expression.trim()) {
      if (showNewStructurePanel && newStructureName.trim()) {
        onExecuteOperation(expression, {
          createNewStructure: true,
          name: newStructureName,
          color: newStructureColor
        });
      } else {
        onExecuteOperation(expression);
      }
    }
  };

  const handleClear = () => {
    setExpression('');
    setNewStructureName('');
    setShowNewStructurePanel(false);
  };

  const handleCloseWithConfirmation = () => {
    if (expression.trim()) {
      // Show confirmation modal when there's active text
      const shouldClose = window.confirm('You have an active operation. Are you sure you want to close?');
      if (shouldClose) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const handleUndo = () => {
    // TODO: Implement undo functionality
    console.log('Undo clicked');
  };

  const handleRedo = () => {
    // TODO: Implement redo functionality
    console.log('Redo clicked');
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-24 lg:left-[58.33%] left-1/2 transform -translate-x-1/2 z-50" style={{ animationName: 'fadeInScale', animationDuration: '300ms', animationTimingFunction: 'ease-out', animationFillMode: 'both' }}>
      <div className="flex items-start space-x-3">
        {/* Main toolbar panel - even larger */}
        <div className="backdrop-blur-sm border border-blue-500/60 rounded-xl px-4 py-3 shadow-2xl bg-gray-900/90 w-[800px]">

          {/* First Row: Title, Info, Text Field */}
          <div className="flex items-center space-x-3 mb-3">
            <div className="flex items-center space-x-2">
              <div 
                className="w-4 h-4 rounded border-2 border-white/60 shadow-sm"
                style={{ backgroundColor: 'rgb(59, 130, 246)' }}
              />
              <span className="text-white text-sm font-medium drop-shadow-sm">Boolean Operations</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowInstructions(!showInstructions)}
                className="h-6 w-6 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 rounded-lg"
                title="Show instructions"
              >
                <Info size={12} />
              </Button>
            </div>

            {/* Main text input field with syntax highlighting overlay */}
            <div className="flex-1 relative">
              {/* Hidden input for actual text entry */}
              <Input
                ref={inputRef}
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder="Enter boolean expression (e.g., A ∪ B - C)"
                className="w-full h-8 bg-white/10 border-white/30 text-transparent text-sm rounded-lg backdrop-blur-sm placeholder:text-white/50 caret-white"
                style={{ caretColor: 'white' }}
              />
              
              {/* Visual overlay with syntax highlighting */}
              <div className="absolute inset-0 pointer-events-none px-3 py-1 flex items-center text-sm">
                {expression ? renderExpressionWithPills() : (
                  <span className="text-white/50">Enter boolean expression (e.g., A ∪ B - C)</span>
                )}
              </div>
              
              {/* Auto-complete suggestions */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full left-0 mt-1 bg-black/90 border border-gray-600 rounded-lg shadow-xl z-50 w-full max-h-32 overflow-y-auto">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => insertStructure(suggestion)}
                      className="w-full text-left px-3 py-1 text-sm text-white hover:bg-blue-900/30 first:rounded-t-lg last:rounded-b-lg"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Close button - within main toolbar */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCloseWithConfirmation}
              className="h-8 w-8 p-0 text-white/70 hover:text-white hover:bg-white/20 rounded-lg ml-2"
              title="Close panel"
            >
              <X size={14} />
            </Button>
          </div>

          <Separator className="my-2 bg-gray-700" />

          {/* Second Row: Boolean Operators and Prominent Undo/Redo */}
          <div className="flex items-center justify-between">
            {/* Boolean operator buttons */}
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => insertText(' ∪ ')}
                className="h-7 px-2 bg-green-900/30 border-2 border-green-400/60 text-green-200 hover:text-green-100 hover:bg-green-800/40 rounded-lg backdrop-blur-sm shadow-sm"
                title="Union"
              >
                <span className="text-xs font-medium mr-1">∪</span>
                <span className="text-xs font-medium">Union</span>
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => insertText(' ∩ ')}
                className="h-7 px-2 bg-blue-900/30 border-2 border-blue-400/60 text-blue-200 hover:text-blue-100 hover:bg-blue-800/40 rounded-lg backdrop-blur-sm shadow-sm"
                title="Intersect"
              >
                <span className="text-xs font-medium mr-1">∩</span>
                <span className="text-xs font-medium">Intersect</span>
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => insertText(' - ')}
                className="h-7 px-2 bg-red-900/30 border-2 border-red-400/60 text-red-200 hover:text-red-100 hover:bg-red-800/40 rounded-lg backdrop-blur-sm shadow-sm"
                title="Subtract"
              >
                <span className="text-xs font-medium mr-1">−</span>
                <span className="text-xs font-medium">Subtract</span>
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => insertText(' ⊕ ')}
                className="h-7 px-2 bg-purple-900/30 border-2 border-purple-400/60 text-purple-200 hover:text-purple-100 hover:bg-purple-800/40 rounded-lg backdrop-blur-sm shadow-sm"
                title="XOR"
              >
                <span className="text-xs font-medium mr-1">⊕</span>
                <span className="text-xs font-medium">XOR</span>
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => { 
                  insertText('(');
                  setTimeout(() => {
                    const input = inputRef.current;
                    if (input) {
                      const pos = input.selectionStart || 0;
                      const value = input.value;
                      const newValue = value.slice(0, pos) + ')' + value.slice(pos);
                      setExpression(newValue);
                      setTimeout(() => {
                        input.focus();
                        input.setSelectionRange(pos, pos);
                      }, 0);
                    }
                  }, 50);
                }}
                className="h-7 px-2 bg-gray-700/50 border-2 border-gray-600 text-gray-300 hover:text-white hover:bg-gray-600/50 rounded-lg backdrop-blur-sm shadow-sm"
                title="Parentheses"
              >
                <span className="text-xs font-medium mr-1">( )</span>
                <span className="text-xs font-medium">Group</span>
              </Button>
              
              {/* Vertical divider */}
              <div className="h-6 w-px bg-gray-600" />
              
              {/* Output related buttons */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!expression.includes('=')) {
                    setExpression(expression + ' = ');
                  }
                }}
                disabled={expression.includes('=')}
                className="h-7 px-2 bg-purple-900/30 border-2 border-purple-400/60 text-purple-200 hover:text-purple-100 hover:bg-purple-800/40 rounded-lg backdrop-blur-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                title="Add output assignment"
              >
                = Output
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowNewStructurePanel(!showNewStructurePanel)}
                disabled={!expression.includes('=')}
                className={`h-7 px-2 rounded-lg backdrop-blur-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                  showNewStructurePanel
                    ? 'bg-purple-900/30 border-2 border-purple-400/60 text-purple-200 hover:text-purple-100 hover:bg-purple-800/40'
                    : 'bg-gray-700/50 border-2 border-gray-600 text-gray-300 hover:text-white hover:bg-gray-600/50'
                }`}
                title={!expression.includes('=') ? "Add '=' to create new structures" : "Create new structure"}
              >
                <Plus className="w-3 h-3 mr-1" />
                <span className="text-xs font-medium">New</span>
              </Button>
            </div>

            {/* Clear, Undo/Redo buttons with more spacing */}
            <div className="flex items-center space-x-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                className="h-7 px-2 bg-red-900/30 border border-red-400/60 text-red-200 hover:text-red-100 hover:bg-red-800/40 rounded-lg backdrop-blur-sm shadow-sm text-xs"
                title="Clear expression"
              >
                Clear
              </Button>
              
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUndo}
                  disabled={true} // TODO: Enable when undo is implemented
                  className="h-7 w-7 p-0 bg-white/10 border-2 border-white/30 text-white hover:text-white hover:bg-white/20 disabled:opacity-50 rounded-lg backdrop-blur-sm shadow-sm"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo className="w-3 h-3" />
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRedo}
                  disabled={true} // TODO: Enable when redo is implemented
                  className="h-7 w-7 p-0 bg-white/10 border-2 border-white/30 text-white hover:text-white hover:bg-white/20 disabled:opacity-50 rounded-lg backdrop-blur-sm shadow-sm"
                  title="Redo (Ctrl+Y)"
                >
                  <Redo className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* New Structure Panel */}
          {showNewStructurePanel && (
            <div className="mt-2 p-3 bg-purple-900/20 border border-purple-400/40 rounded-lg">
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">New Structure Name</label>
                  <Input
                    value={newStructureName}
                    onChange={(e) => setNewStructureName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newStructureName.trim()) {
                        // Add the new structure name to the expression
                        insertText(newStructureName.trim());
                        setNewStructureName('');
                        setShowNewStructurePanel(false);
                        inputRef.current?.focus();
                      }
                    }}
                    placeholder="e.g. CombinedStructure"
                    className="w-full h-8 bg-white/10 border-white/30 text-white text-sm rounded-lg backdrop-blur-sm placeholder:text-gray-400"
                  />
                </div>
                
                <div className="flex items-center space-x-2">
                  <label className="text-xs text-gray-400">Color:</label>
                  <input
                    type="color"
                    value={newStructureColor}
                    onChange={(e) => setNewStructureColor(e.target.value)}
                    className="h-8 w-16 rounded cursor-pointer bg-black/30 border border-white/30"
                  />
                  <span className="text-xs text-gray-400">{newStructureColor}</span>
                </div>
              </div>
            </div>
          )}

          {/* Instructions Panel */}
          {showInstructions && (
            <div className="mt-2 p-3 bg-black/90 border border-gray-600 rounded-lg text-xs text-gray-300">
              <div className="space-y-1">
                <div>• Type structure names to see suggestions</div>
                <div>• Use boolean operators: ∪ (union), ∩ (intersect), - (subtract), ⊕ (XOR)</div>
                <div>• Example: Parotid_L ∪ Parotid_R - SpinalCord</div>
              </div>
            </div>
          )}
        </div>

        {/* Floating action buttons - Preview and Run only, slightly larger */}
        <div className="flex flex-col space-y-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLivePreview(!livePreview)}
            className={`h-7 w-14 rounded backdrop-blur-sm shadow-sm border text-[11px] font-medium p-0 ${
              livePreview 
                ? 'bg-yellow-700/50 border-yellow-500 text-yellow-200 hover:bg-yellow-600/60' 
                : 'bg-yellow-900/30 border-yellow-400/60 text-yellow-200 hover:text-yellow-100 hover:bg-yellow-800/40'
            }`}
            title="Toggle preview"
          >
            Preview
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleExecute}
            disabled={!expression.trim()}
            className="h-7 w-14 bg-green-700/50 border border-green-600 text-green-300 hover:text-green-200 hover:bg-green-600/50 disabled:opacity-50 disabled:cursor-not-allowed rounded backdrop-blur-sm shadow-sm text-[11px] font-medium p-0"
            title="Execute expression"
          >
            Run
          </Button>
        </div>
      </div>
    </div>
  );
}