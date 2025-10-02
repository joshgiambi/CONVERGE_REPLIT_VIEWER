/**
 * ViewerShell Component
 * 
 * Layout wrapper for viewer components.
 * Pure layout - no business logic.
 * 
 * Agent 1: Viewer Core  
 * Created: Hour 14-16
 */

import type { ViewerShellProps } from '@/types/viewer';

export function ViewerShell({
  sidebar,
  viewport,
  toolbar,
  panels,
  children,
}: ViewerShellProps) {
  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Toolbar at top */}
      {toolbar && (
        <div className="flex justify-center py-4">
          {toolbar}
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex gap-4 px-4 pb-4 overflow-hidden">
        {/* Sidebar */}
        {sidebar && (
          <div className="w-96 flex-shrink-0 overflow-y-auto">
            {sidebar}
          </div>
        )}

        {/* Viewport */}
        <div className="flex-1 relative">
          {viewport}
        </div>
      </div>

      {/* Floating panels */}
      {panels}

      {/* Additional children */}
      {children}
    </div>
  );
}

