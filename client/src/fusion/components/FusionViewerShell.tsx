import type { ReactNode } from 'react';

interface FusionViewerShellProps {
  sidebar: ReactNode;
  viewport: ReactNode;
  toolbar?: ReactNode;
  fusionPanel?: ReactNode;
  children?: ReactNode;
}

export function FusionViewerShell({
  sidebar,
  viewport,
  toolbar,
  fusionPanel,
  children,
}: FusionViewerShellProps) {
  return (
    <>
      {toolbar}
      <div className="animate-in fade-in-50 duration-500">
        <div className="flex gap-4" style={{ height: 'calc(100vh - 8rem)' }}>
          <div className="w-full md:w-96 h-full overflow-hidden flex-shrink-0 hidden md:block">
            {sidebar}
          </div>
          <div className="flex-1 relative overflow-hidden">
            {viewport}
          </div>
        </div>
      </div>
      {fusionPanel}
      {children}
    </>
  );
}
