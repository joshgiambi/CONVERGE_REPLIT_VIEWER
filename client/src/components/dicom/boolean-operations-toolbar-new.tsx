import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { X, Play, Info, Plus, Eye, Undo, Redo, Eraser } from 'lucide-react';

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

  // Auto-complete logic
  useEffect(() => {
    if (expression.length > 0) {
      const lastWord = expression.split(/[\s\(\)\+\-\*\/\&\|]/).pop() || '';
      if (lastWord.length >= 2) {
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
    const words = expression.split(/(\s+|\(|\)|∪|∩|-|⊕)/);
    const lastWordIndex = words.findLastIndex(word => word.trim() && !['∪', '∩', '-', '⊕', '(', ')'].includes(word));
    
    if (lastWordIndex !== -1) {
      words[lastWordIndex] = structureName;
      setExpression(words.join(''));
    } else {
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
      <div className="relative">
        <div className="backdrop-blur-md border border-blue-500/60 rounded-xl px-4 py-3 shadow-2xl bg-blue-950/20 w-[900px]">
          {/* First Row: Title, Info, Text Field, Clear, Preview, Run, Close */}
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

            {/* Main text input field - takes up most space */}
            <div className="flex-1 relative">
              <Input
                ref={inputRef}
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder="Enter boolean expression (e.g., A ∪ B - C)"
                className="w-full h-8 bg-white/10 border-white/30 text-white text-sm rounded-lg backdrop-blur-sm placeholder:text-white/50"
              />
              
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

            {/* Action buttons */}
            <div className="flex items-center space-x-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                className="h-8 px-3 bg-gray-700/50 border-2 border-gray-600 text-gray-300 hover:text-white hover:bg-gray-600/50 text-xs rounded-lg backdrop-blur-sm shadow-sm"
              >
                Clear
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLivePreview(!livePreview)}
                className={`h-8 px-3 text-xs rounded-lg backdrop-blur-sm shadow-sm border-2 ${
                  livePreview 
                    ? 'bg-yellow-600/50 border-yellow-500 text-yellow-200 hover:bg-yellow-500/60' 
                    : 'bg-gray-700/50 border-gray-600 text-gray-300 hover:text-white hover:bg-gray-600/50'
                }`}
              >
                <Eye size={12} className="mr-1" />
                Preview
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleExecute}
                disabled={!expression.trim()}
                className="h-8 px-3 bg-green-700/50 border-2 border-green-600 text-green-300 hover:text-green-200 hover:bg-green-600/50 disabled:opacity-50 disabled:cursor-not-allowed text-xs rounded-lg backdrop-blur-sm shadow-sm"
              >
                <Play size={12} className="mr-1" />
                Run
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

          {/* Second Row: Boolean Operators and Prominent Undo/Redo */}
          <div className="flex items-center justify-between">
            {/* Boolean operator buttons */}
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => insertText(' ∪ ')}
                className="h-8 px-3 text-gray-300 hover:bg-gray-700/50 hover:text-white rounded-lg text-xs"
                title="Union"
              >
                <span className="text-base mr-1">∪</span>
                Union
              </Button>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => insertText(' ∩ ')}
                className="h-8 px-3 text-gray-300 hover:bg-gray-700/50 hover:text-white rounded-lg text-xs"
                title="Intersect"
              >
                <span className="text-base mr-1">∩</span>
                Intersect
              </Button>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => insertText(' - ')}
                className="h-8 px-3 text-gray-300 hover:bg-gray-700/50 hover:text-white rounded-lg text-xs"
                title="Subtract"
              >
                <span className="text-base mr-1">−</span>
                Subtract
              </Button>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => insertText(' ⊕ ')}
                className="h-8 px-3 text-gray-300 hover:bg-gray-700/50 hover:text-white rounded-lg text-xs"
                title="XOR"
              >
                <span className="text-base mr-1">⊕</span>
                XOR
              </Button>
              
              <Button
                variant="ghost"
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
                className="h-8 px-3 text-gray-300 hover:bg-gray-700/50 hover:text-white rounded-lg text-xs"
                title="Parentheses"
              >
                <span className="text-base mr-1">( )</span>
                Group
              </Button>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNewStructurePanel(!showNewStructurePanel)}
                className={`h-8 px-3 rounded-lg text-xs ${
                  showNewStructurePanel
                    ? 'bg-purple-600/20 border border-purple-500 text-purple-200'
                    : 'text-gray-300 hover:bg-gray-700/50 hover:text-white'
                }`}
                title="Create new structure"
              >
                <Plus size={12} className="mr-1" />
                New
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

          {/* New Structure Panel */}
          {showNewStructurePanel && (
            <div className="mt-2 p-3 bg-purple-900/20 border border-purple-400/40 rounded-lg">
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">New Structure Name</label>
                  <Input
                    value={newStructureName}
                    onChange={(e) => setNewStructureName(e.target.value)}
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
      </div>
    </div>
  );
}