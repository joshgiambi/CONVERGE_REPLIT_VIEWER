import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { X, Play } from 'lucide-react';

interface BooleanOperationsToolbarProps {
  isVisible: boolean;
  onClose: () => void;
  availableStructures: string[];
  onExecuteOperation: (expression: string) => void;
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-complete logic
  useEffect(() => {
    console.log('Auto-complete debug:', { expression, availableStructures: availableStructures.length });
    if (expression.length > 0) {
      const lastWord = expression.split(/[\s\(\)\+\-\*\/\&\|]/).pop() || '';
      console.log('Last word:', lastWord);
      if (lastWord.length >= 2) {
        const filtered = availableStructures.filter(structure =>
          structure.toLowerCase().includes(lastWord.toLowerCase())
        );
        console.log('Filtered suggestions:', filtered);
        setSuggestions(filtered.slice(0, 5)); // Show max 5 suggestions
        setShowSuggestions(filtered.length > 0);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  }, [expression, availableStructures]);

  const insertText = (text: string) => {
    const input = inputRef.current;
    if (input) {
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const newExpression = expression.substring(0, start) + text + expression.substring(end);
      setExpression(newExpression);
      
      // Set cursor position after inserted text
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + text.length, start + text.length);
      }, 0);
    }
  };

  const insertStructure = (structureName: string) => {
    // Replace the partial word being typed
    const words = expression.split(/(\s|\(|\)|\+|\-|\*|\/|\&|\|)/);
    const lastWordIndex = words.length - 1;
    const lastWord = words[lastWordIndex];
    
    if (lastWord && availableStructures.some(s => s.toLowerCase().includes(lastWord.toLowerCase()))) {
      words[lastWordIndex] = structureName;
      setExpression(words.join(''));
    } else {
      insertText(structureName);
    }
    setShowSuggestions(false);
  };

  const handleExecute = () => {
    if (expression.trim()) {
      onExecuteOperation(expression);
    }
  };

  const booleanButtons = [
    { label: 'Union', symbol: ' ∪ ', tooltip: 'Union (A + B)' },
    { label: 'Intersect', symbol: ' ∩ ', tooltip: 'Intersection (A & B)' },
    { label: 'Subtract', symbol: ' - ', tooltip: 'Subtraction (A - B)' },
    { label: 'XOR', symbol: ' ⊕ ', tooltip: 'Exclusive OR (A ⊕ B)' },
    { label: '(', symbol: '(', tooltip: 'Open parenthesis' },
    { label: ')', symbol: ')', tooltip: 'Close parenthesis' },
    { label: 'Clear', symbol: '', tooltip: 'Clear expression' },
    { label: 'Execute', symbol: '', tooltip: 'Execute operation' }
  ];

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-24 lg:left-[58.33%] left-1/2 transform -translate-x-1/2 z-50" style={{ animationName: 'fadeInScale', animationDuration: '300ms', animationTimingFunction: 'ease-out', animationFillMode: 'both' }}>
      <div className="relative">
        <div className="backdrop-blur-md border border-blue-500/60 rounded-xl px-4 py-3 shadow-2xl bg-blue-950/20">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div 
              className="w-4 h-4 rounded border-2 border-white/60 shadow-sm"
              style={{ backgroundColor: 'rgb(59, 130, 246)' }} // Blue color for boolean operations
            />
            <span className="text-white text-sm font-medium drop-shadow-sm">Boolean Operations</span>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/20 h-7 w-7 p-0 rounded-lg backdrop-blur-sm shadow-sm"
          >
            <X size={14} />
          </Button>
        </div>

        <Separator className="my-2 bg-gray-700" />

        {/* Expression Input */}
        <div className="relative mb-3">
          <Input
            ref={inputRef}
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="Enter boolean expression (e.g., Parotid_L ∪ Parotid_R)"
            className="w-full h-7 bg-white/10 border-white/30 text-white text-sm rounded-lg backdrop-blur-sm placeholder-gray-400"
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

        {/* Boolean Operation Buttons */}
        <div className="flex items-center space-x-1 mb-3">
          {booleanButtons.map((btn, index) => (
            <Button
              key={index}
              variant="ghost"
              size="sm"
              className={`h-7 px-2 text-xs transition-all duration-200 rounded-lg backdrop-blur-sm shadow-sm ${
                btn.label === 'Clear' 
                  ? 'bg-red-900/30 border-2 border-red-400/60 text-red-200 hover:text-red-100 hover:bg-red-800/40' 
                  : btn.label === 'Execute'
                  ? 'bg-green-900/30 border-2 border-green-400/60 text-green-200 hover:text-green-100 hover:bg-green-800/40'
                  : 'bg-white/10 border-2 border-white/30 text-white hover:text-white hover:bg-white/20'
              }`}
              onClick={() => {
                if (btn.label === 'Clear') {
                  setExpression('');
                } else if (btn.label === 'Execute') {
                  handleExecute();
                } else {
                  insertText(btn.symbol);
                }
              }}
              title={btn.tooltip}
            >
              {btn.label === 'Execute' ? <Play className="w-3 h-3" /> : btn.label}
            </Button>
          ))}
        </div>

        {/* Instructions */}
        <div className="text-xs text-gray-400 space-y-1">
          <div className="text-xs text-gray-400">
            • Type structure names to see suggestions
          </div>
          <div className="text-xs text-gray-400">
            • Use buttons to insert boolean operators
          </div>
          <div className="text-xs text-gray-400">
            • Example: Parotid_L ∪ Parotid_R - SpinalCord
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}