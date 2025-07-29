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
  const [outputStructure, setOutputStructure] = useState('');
  const [createNewOutput, setCreateNewOutput] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [outputSuggestions, setOutputSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showOutputSuggestions, setShowOutputSuggestions] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [livePreview, setLivePreview] = useState(false);
  const [newStructureColor, setNewStructureColor] = useState('#3B82F6');
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLInputElement>(null);
  const [showPillView, setShowPillView] = useState(false);
  
  // Parse expression to identify structure names and operators
  const renderExpressionWithPills = () => {
    if (!expression) return null;
    
    // Create a regex pattern from available structures (escape special characters)
    const structurePattern = availableStructures
      .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    
    if (!structurePattern) return expression;
    
    // Split expression by structure names and operators
    const regex = new RegExp(`(${structurePattern}|[∪∩⊕\\-()]|\\s+)`, 'gi');
    const parts = expression.split(regex).filter(part => part);
    
    return (
      <div className="flex items-center flex-wrap gap-1">
        {parts.map((part, index) => {
          // Check if this part is a structure name
          const isStructure = availableStructures.some(
            s => s.toLowerCase() === part.toLowerCase()
          );
          
          if (isStructure) {
            // Render as a pill
            return (
              <span
                key={index}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/50 text-blue-200 border border-blue-500/50"
              >
                {part}
              </span>
            );
          } else if (['∪', '∩', '⊕', '-'].includes(part.trim())) {
            // Render operators with styling
            return (
              <span key={index} className="text-yellow-400 font-bold px-1">
                {part}
              </span>
            );
          } else {
            // Render other text (spaces, parentheses, etc)
            return <span key={index} className="text-white">{part}</span>;
          }
        })}
      </div>
    );
  };

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

  // Output structure auto-complete logic
  useEffect(() => {
    if (outputStructure.length > 0) {
      const filtered = availableStructures.filter(structure =>
        structure.toLowerCase().includes(outputStructure.toLowerCase())
      );
      setOutputSuggestions(filtered.slice(0, 5));
      setShowOutputSuggestions(filtered.length > 0 && !createNewOutput);
    } else {
      setShowOutputSuggestions(false);
    }
  }, [outputStructure, availableStructures, createNewOutput]);

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

  const insertOutputStructure = (structureName: string) => {
    setOutputStructure(structureName);
    setShowOutputSuggestions(false);
    setTimeout(() => {
      if (outputRef.current) {
        outputRef.current.focus();
      }
    }, 0);
  };

  const handleExecute = () => {
    if (expression.trim() && outputStructure.trim()) {
      if (createNewOutput) {
        onExecuteOperation(expression, {
          createNewStructure: true,
          name: outputStructure,
          color: newStructureColor
        });
      } else {
        onExecuteOperation(expression);
      }
    }
  };

  const handleClear = () => {
    setExpression('');
    setOutputStructure('');
    setCreateNewOutput(false);
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
      <div className="relative">
        <div className="backdrop-blur-md border border-blue-500/60 rounded-xl px-4 py-3 shadow-2xl bg-blue-950/80 w-[900px]">
          {/* Header Row: Title, Info, Close */}
          <div className="flex items-center justify-between mb-3">
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

            {/* Close button with confirmation */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCloseWithConfirmation}
              className="h-8 w-8 p-0 text-white/70 hover:text-white hover:bg-white/20 rounded-lg"
            >
              <X size={14} />
            </Button>
          </div>

          {/* Expression Input Row */}
          <div className="mb-3">
            <div className="flex items-center space-x-2 mb-2">
              <span className="text-white/80 text-xs font-medium min-w-[80px]">Expression:</span>
            </div>
            <div className="relative">
              <Input
                ref={inputRef}
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder="Enter boolean expression (e.g., A ∪ B - C)"
                className="w-full h-8 bg-white/10 border-white/30 text-white text-sm rounded-lg backdrop-blur-sm placeholder:text-white/50"
              />
              
              {/* Expression with pills view */}
              {expression && availableStructures.length > 0 && (
                <div className="mt-2 p-2 bg-black/30 rounded-lg border border-white/20">
                  <div className="text-xs text-gray-400 mb-1">Preview:</div>
                  {renderExpressionWithPills()}
                </div>
              )}
              
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
          </div>

          {/* Output Structure Row */}
          <div className="mb-3">
            <div className="flex items-center space-x-2 mb-2">
              <span className="text-white/80 text-xs font-medium min-w-[80px]">Output to:</span>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateNewOutput(false)}
                  className={`h-6 px-2 text-xs rounded-lg backdrop-blur-sm shadow-sm border ${
                    !createNewOutput 
                      ? 'bg-blue-700/50 border-blue-500 text-blue-200' 
                      : 'bg-gray-700/30 border-gray-600 text-gray-400 hover:text-white hover:bg-gray-600/50'
                  }`}
                >
                  Existing
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateNewOutput(true)}
                  className={`h-6 px-2 text-xs rounded-lg backdrop-blur-sm shadow-sm border ${
                    createNewOutput 
                      ? 'bg-blue-700/50 border-blue-500 text-blue-200' 
                      : 'bg-gray-700/30 border-gray-600 text-gray-400 hover:text-white hover:bg-gray-600/50'
                  }`}
                >
                  New
                </Button>
              </div>
            </div>
            <div className="relative">
              <Input
                ref={outputRef}
                value={outputStructure}
                onChange={(e) => setOutputStructure(e.target.value)}
                placeholder={createNewOutput ? "Enter new structure name" : "Select existing structure"}
                className="w-full h-8 bg-white/10 border-white/30 text-white text-sm rounded-lg backdrop-blur-sm placeholder:text-white/50"
              />
              
              {/* Output structure auto-complete suggestions */}
              {showOutputSuggestions && outputSuggestions.length > 0 && (
                <div className="absolute top-full left-0 mt-1 bg-black/90 border border-gray-600 rounded-lg shadow-xl z-50 w-full max-h-32 overflow-y-auto">
                  {outputSuggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        setOutputStructure(suggestion);
                        setShowOutputSuggestions(false);
                      }}
                      className="w-full text-left px-3 py-1 text-sm text-white hover:bg-blue-900/30 first:rounded-t-lg last:rounded-b-lg"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                className="h-8 px-3 bg-red-900/30 border-2 border-red-400/60 text-red-200 hover:text-red-100 hover:bg-red-800/40 text-xs rounded-lg backdrop-blur-sm shadow-sm"
              >
                <Trash2 size={12} className="mr-1" />
                Clear
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLivePreview(!livePreview)}
                className={`h-8 px-3 text-xs rounded-lg backdrop-blur-sm shadow-sm border-2 ${
                  livePreview 
                    ? 'bg-yellow-700/50 border-yellow-500 text-yellow-200 hover:bg-yellow-600/60' 
                    : 'bg-yellow-900/30 border-yellow-400/60 text-yellow-200 hover:text-yellow-100 hover:bg-yellow-800/40'
                }`}
              >
                <Eye size={12} className="mr-1" />
                Preview
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleExecute}
                disabled={!expression.trim() || !outputStructure.trim()}
                className="h-8 px-3 bg-green-700/50 border-2 border-green-600 text-green-300 hover:text-green-200 hover:bg-green-600/50 disabled:opacity-50 disabled:cursor-not-allowed text-xs rounded-lg backdrop-blur-sm shadow-sm"
              >
                <Play size={12} className="mr-1" />
                Run
              </Button>
            </div>

            {/* Undo/Redo buttons on the right */}
            <div className="flex items-center space-x-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                className="h-8 px-2 bg-gray-700/50 border-2 border-gray-600 text-gray-300 hover:text-white hover:bg-gray-600/50 text-xs rounded-lg backdrop-blur-sm shadow-sm"
                title="Undo"
              >
                <Undo size={12} />
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleRedo}
                className="h-8 px-2 bg-gray-700/50 border-2 border-gray-600 text-gray-300 hover:text-white hover:bg-gray-600/50 text-xs rounded-lg backdrop-blur-sm shadow-sm"
                title="Redo"
              >
                <Redo size={12} />
              </Button>
            </div>
          </div>

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
              

            </div>

            {/* Prominent Undo/Redo buttons */}
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
      </div>
    </div>
  );
}