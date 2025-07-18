import { useState, useEffect } from 'react';

export function useParsingSession() {
  const [hasActiveSession, setHasActiveSession] = useState(false);
  
  useEffect(() => {
    const checkActiveSession = async () => {
      // Check for both upload and parsing sessions
      const uploadActive = localStorage.getItem('uploadActive') === 'true';
      const sessionId = localStorage.getItem('currentParseSessionId');
      
      if (uploadActive) {
        setHasActiveSession(true);
        return;
      }
      
      if (!sessionId) {
        setHasActiveSession(false);
        return;
      }

      try {
        const response = await fetch(`/api/parse-dicom-session/${sessionId}`);
        if (response.ok) {
          const session = await response.json();
          // Only show as active if session is actively parsing
          const isActive = session.status === 'parsing';
          setHasActiveSession(isActive);
          
          // Clean up if session is complete or errored
          if (session.status === 'complete' || session.status === 'error') {
            localStorage.removeItem('currentParseSessionId');
          }
        } else {
          setHasActiveSession(false);
          localStorage.removeItem('currentParseSessionId');
        }
      } catch (error) {
        setHasActiveSession(false);
      }
    };

    // Check immediately
    checkActiveSession();

    // Check periodically
    const interval = setInterval(checkActiveSession, 1000);

    // Also listen for storage events to sync across tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'currentParseSessionId' || e.key === 'uploadActive') {
        checkActiveSession();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  return hasActiveSession;
}