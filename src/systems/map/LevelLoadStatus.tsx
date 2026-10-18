/**
 * LevelLoadStatus — the loading / error cards for level and Reach loads.
 *
 * Split from LevelLoader so the HUD shell (ExperienceUI), which shows them for any
 * map source, does not pull LevelLoader and its level-parsing hook into the entry chunk.
 */

import React from 'react';

// Error display component
export const ErrorDisplay: React.FC<{ 
  error: string; 
  onRetry?: () => void;
  onDismiss?: () => void;
}> = ({ error, onRetry, onDismiss }) => (
  <div style={{
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(180, 40, 40, 0.95)',
    color: 'white',
    padding: '24px 32px',
    borderRadius: '8px',
    maxWidth: '500px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    zIndex: 10000,
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
  }}>
    <h3 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>⚠ Level Load Error</h3>
    <pre style={{ 
      margin: '0 0 16px 0', 
      whiteSpace: 'pre-wrap',
      fontSize: '13px',
      lineHeight: 1.5,
      opacity: 0.9,
    }}>{error}</pre>
    <div style={{ display: 'flex', gap: '12px' }}>
      {onRetry && (
        <button 
          onClick={onRetry}
          style={{
            padding: '8px 16px',
            background: 'white',
            color: '#b42828',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          Retry
        </button>
      )}
      {onDismiss && (
        <button 
          onClick={onDismiss}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            color: 'white',
            border: '1px solid white',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  </div>
);

// Loading display component
export const LoadingDisplay: React.FC<{ 
  message?: string;
  progress?: number;
}> = ({ message = 'Loading level...', progress }) => (
  <div style={{
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(0, 0, 0, 0.85)',
    color: 'white',
    padding: '24px 32px',
    borderRadius: '8px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    zIndex: 10000,
    textAlign: 'center',
  }}>
    <div style={{ 
      width: '40px', 
      height: '40px', 
      border: '3px solid rgba(255,255,255,0.2)',
      borderTop: '3px solid white',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      margin: '0 auto 16px',
    }} />
    <style>{`
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
    <p style={{ margin: 0, fontSize: '14px' }}>{message}</p>
    {progress !== undefined && (
      <div style={{
        width: '200px',
        height: '4px',
        background: 'rgba(255,255,255,0.2)',
        borderRadius: '2px',
        marginTop: '12px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: 'white',
          transition: 'width 0.3s ease',
        }} />
      </div>
    )}
  </div>
);
