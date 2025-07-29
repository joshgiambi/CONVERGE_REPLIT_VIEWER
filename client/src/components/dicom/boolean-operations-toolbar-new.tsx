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
        <div className="backdrop-blur-md border border-blue-500/60 rounded-xl px-4 py-3 shadow-2xl bg-blue-950/20 w-[600px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-3">
              <div 
                className="w-4 h-4 rounded border-2 border-white/60 shadow-sm"
                style={{ backgroundColor: 'rgb(59, 130, 246)' }}
              />
              <span className="text-white text-sm font-medium drop-shadow-sm">Boolean Operations</span>
            </div>
            
            <div className="flex items-center space-x-1">
              {/* Info Button */}
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onMouseEnter={() => setShowInstructions(true)}
                  onMouseLeave={() => setShowInstructions(false)}
                  className="text-white/70 hover:text-white hover:bg-white/20 h-7 w-7 p-0 rounded-lg backdrop-blur-sm shadow-sm"
                >
                  <Info size={14} />
                </Button>
                
                {showInstructions && (
                  <div className="absolute top-full right-0 mt-2 p-3 bg-black/90 rounded-lg shadow-xl z-50 w-64 text-xs text-gray-300">
                    <div className="space-y-1">
                      <div>• Type structure names to see suggestions</div>
                      <div>• Use boolean operators: ∪ (union), ∩ (intersect), - (subtract), ⊕ (XOR)</div>
                      <div>• Example: Parotid_L ∪ Parotid_R - SpinalCord</div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Close Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-white/70 hover:text-white hover:bg-white/20 h-7 w-7 p-0 rounded-lg backdrop-blur-sm shadow-sm"
              >
                <X size={14} />
              </Button>
            </div>
          </div>

          <Separator className="my-2 bg-gray-700" />

          {/* New Structure Panel */}
          {showNewStructurePanel && (
            <div className="mb-3 p-3 bg-purple-900/20 border border-purple-400/40 rounded-lg">
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">New Structure Name</label>
                  <Input
                    value={newStructureName}
                    onChange={(e) => setNewStructureName(e.target.value)}
                    placeholder="e.g. CombinedStructure"
                    className="w-full h-8 bg-white/10 border-white/30 text-white text-sm rounded-lg backdrop-blur-sm placeholder-gray-400"
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

          {/* Main Input Row */}
          <div className="flex items-center space-x-2">
            {/* Expression Input */}
            <div className="relative flex-1">
              <Input
                ref={inputRef}
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder="Enter boolean expression (e.g., Parotid_L ∪ Parotid_R)"
                className="w-full h-9 bg-white/10 border-white/30 text-white text-sm rounded-lg backdrop-blur-sm placeholder-gray-400"
              />
              
              {/* Auto-complete suggestions */}
              {showSuggestions && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-10 max-h-32 overflow-y-auto">
                  {suggestions.map((structure, index) => (
                    <button
                      key={index}
                      className="w-full text-left px-3 py-2 text-sm text-white hover:bg-gray-700 first:rounded-t-lg last:rounded-b-lg"
                      onClick={() => insertStructure(structure)}
                    >
                      {structure}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Clear Button */}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-3 text-xs transition-all duration-200 rounded-lg backdrop-blur-sm shadow-sm bg-red-900/30 border-2 border-red-400/60 text-red-200 hover:text-red-100 hover:bg-red-800/40"
              onClick={handleClear}
              title="Clear expression"
            >
              <Eraser className="w-4 h-4" />
              Clear
            </Button>

            {/* Preview Button */}
            <Button
              variant="ghost"
              size="sm"
              className={`h-9 px-3 text-xs transition-all duration-200 rounded-lg backdrop-blur-sm shadow-sm ${
                livePreview 
                  ? 'bg-yellow-900/30 border-2 border-yellow-400/60 text-yellow-200 hover:text-yellow-100 hover:bg-yellow-800/40' 
                  : 'bg-white/10 border-2 border-white/30 text-white hover:text-white hover:bg-white/20'
              }`}
              onClick={() => setLivePreview(!livePreview)}
              title="Toggle live preview"
            >
              <Eye className="w-4 h-4" />
              Preview
            </Button>

            {/* Run Button */}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-3 text-xs transition-all duration-200 rounded-lg backdrop-blur-sm shadow-sm bg-green-900/30 border-2 border-green-400/60 text-green-200 hover:text-green-100 hover:bg-green-800/40"
              onClick={handleExecute}
              title="Execute boolean operation"
            >
              <Play className="w-4 h-4" />
              Run
            </Button>
          </div>

          {/* Bottom Row: Boolean Operators, Undo/Redo */}
          <div className="flex items-center justify-between mt-3">
            {/* Boolean Operator Buttons */}
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs bg-white/10 border border-white/30 text-white hover:bg-white/20"
                onClick={() => insertText(' ∪ ')}
                title="Union (A + B)"
              >
                Union
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs bg-white/10 border border-white/30 text-white hover:bg-white/20"
                onClick={() => insertText(' ∩ ')}
                title="Intersection (A & B)"
              >
                Intersect
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs bg-white/10 border border-white/30 text-white hover:bg-white/20"
                onClick={() => insertText(' - ')}
                title="Subtraction (A - B)"
              >
                Subtract
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs bg-white/10 border border-white/30 text-white hover:bg-white/20"
                onClick={() => insertText(' ⊕ ')}
                title="Exclusive OR (A ⊕ B)"
              >
                XOR
              </Button>
              
              <div className="w-px h-5 bg-white/30 mx-1" />
              
              {/* New Structure Button */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs transition-all duration-200 rounded-lg backdrop-blur-sm shadow-sm bg-purple-900/30 border-2 border-purple-400/60 text-purple-200 hover:text-purple-100 hover:bg-purple-800/40"
                onClick={() => setShowNewStructurePanel(!showNewStructurePanel)}
                title="Create new structure"
              >
                <Plus className="w-3 h-3" />
                New
              </Button>
            </div>

            {/* Undo/Redo Buttons */}
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-white/50 hover:text-white hover:bg-white/20 disabled:opacity-50"
                onClick={handleUndo}
                disabled={true} // TODO: Enable when undo stack has items
                title="Undo"
              >
                <Undo className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-white/50 hover:text-white hover:bg-white/20 disabled:opacity-50"
                onClick={handleRedo}
                disabled={true} // TODO: Enable when redo stack has items
                title="Redo"
              >
                <Redo className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}