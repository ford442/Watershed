import React from 'react';
import ReactDOM from 'react-dom/client';
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

// @react-three/rapier's Physics component initialises Rapier via its own
// suspend() call, so no separate pre-init is needed here.
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
