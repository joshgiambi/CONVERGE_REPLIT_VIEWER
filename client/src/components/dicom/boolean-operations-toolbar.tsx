import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    <div className="fixed bottom-4 left-4 z-50 animate-in fade-in zoom-in-95 duration-300">
      <div className="bg-black/90 backdrop-blur-md border border-blue-500/50 rounded-xl shadow-2xl p-4 w-96">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold text-sm flex items-center">
            <div className="w-2 h-2 bg-blue-400 rounded-full mr-2"></div>
            Boolean Operations
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-gray-400 hover:text-white"
            onClick={onClose}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>

        {/* Expression Input */}
        <div className="relative mb-4">
          <Input
            ref={inputRef}
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="Enter boolean expression (e.g., Parotid_L ∪ Parotid_R)"
            className="bg-gray-900 border-gray-600 text-white placeholder-gray-400 text-sm"
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
        <div className="grid grid-cols-4 gap-2 mb-4">
          {booleanButtons.map((btn, index) => (
            <Button
              key={index}
              variant="ghost"
              size="sm"
              className={`h-8 text-xs ${
                btn.label === 'Clear' 
                  ? 'text-red-400 hover:text-red-300 hover:bg-red-500/20' 
                  : btn.label === 'Execute'
                  ? 'text-green-400 hover:text-green-300 hover:bg-green-500/20'
                  : 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/20'
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
          <p>• Type structure names to see suggestions</p>
          <p>• Use buttons to insert boolean operators</p>
          <p>• Example: Parotid_L ∪ Parotid_R - SpinalCord</p>
        </div>
      </div>
    </div>
  );
}