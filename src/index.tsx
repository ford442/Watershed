import React from 'react';
import ReactDOM from 'react-dom/client';
import RAPIER from '@dimforge/rapier3d-compat';
import App from './App';

// Global error handlers to catch silent failures
window.onerror = (message, source, lineno, colno, error) => {
  console.error('[Global Error Handler]', {
    message,
    source,
    lineno,
    colno,
    error
  });
  return false;
};

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', event.reason);
  console.error('[Promise]', event.promise);
});

// Pre-initialize Rapier before @react-three/rapier mounts its Physics component.
// Using the same 0.19.2 version as @react-three/rapier prevents duplicate init
// and suppresses the "deprecated parameters" warning.
RAPIER.init().then(() => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('[index.tsx] FATAL: Root element not found!');
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'color: red; font-size: 20px; padding: 20px;';
    errorDiv.textContent = 'ERROR: Root element #root not found in DOM';
    document.body.appendChild(errorDiv);
  } else {
    const root = ReactDOM.createRoot(rootElement as HTMLElement);
    root.render(<App />);
  }
});
