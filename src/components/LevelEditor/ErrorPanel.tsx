/**
 * Error Panel Component
 * 
 * Displays real-time validation feedback with field-level error indicators
 * and actionable fix suggestions.
 */

import React from 'react';
import { ValidationError } from '../../utils/levelValidator';

interface ErrorPanelProps {
  errors: ValidationError[];
  warnings: ValidationError[];
  onNavigateToField?: (field: string) => void;
  onAutoFix?: (error: ValidationError) => void;
  onDismissError?: (index: number) => void;
  onDismissWarning?: (index: number) => void;
}

// Error severity icons
const ErrorIcon = () => (
  <span style={{ color: '#ef4444', fontSize: '14px' }}>●</span>
);

const WarningIcon = () => (
  <span style={{ color: '#f59e0b', fontSize: '14px' }}>●</span>
);

// Auto-fixable error patterns
const AUTO_FIXABLE_PATTERNS = [
  { pattern: /must be >= (\d+\.?\d*)/, type: 'min' },
  { pattern: /must be <= (\d+\.?\d*)/, type: 'max' },
  { pattern: /must match pattern/, type: 'pattern' },
  { pattern: /must have required property/, type: 'required' },
];

export const ErrorPanel: React.FC<ErrorPanelProps> = ({
  errors,
  warnings,
  onNavigateToField,
  onAutoFix,
  onDismissError,
  onDismissWarning,
}) => {
  const totalIssues = errors.length + warnings.length;

  if (totalIssues === 0) {
    return (
      <div style={{
        padding: '16px',
        background: '#0a1f0a',
        border: '1px solid #2a5a2a',
        borderRadius: '8px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>✓</span>
          <span style={{ color: '#4ade80', fontWeight: 600 }}>All Valid!</span>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#6ab06a' }}>
          No errors or warnings found. Your level is ready to play.
        </p>
      </div>
    );
  }

  const canAutoFix = (error: ValidationError): boolean => {
    return AUTO_FIXABLE_PATTERNS.some(p => p.pattern.test(error.error));
  };

  const getFixLabel = (error: ValidationError): string => {
    if (error.error.includes('must be >=')) return 'Set to minimum';
    if (error.error.includes('must be <=')) return 'Set to maximum';
    if (error.error.includes('must match pattern')) return 'Fix format';
    if (error.error.includes('must have required property')) return 'Add field';
    return 'Fix';
  };

  return (
    <div style={{
      maxHeight: '400px',
      overflowY: 'auto',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
    }}>
      {/* Summary */}
      <div style={{
        padding: '12px 16px',
        background: errors.length > 0 ? '#1f0a0a' : '#1f1a0a',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {errors.length > 0 && (
            <span style={{ color: '#ef4444', fontWeight: 600 }}>
              {errors.length} Error{errors.length !== 1 ? 's' : ''}
            </span>
          )}
          {warnings.length > 0 && (
            <span style={{ color: '#f59e0b', fontWeight: 600 }}>
              {warnings.length} Warning{warnings.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span style={{ fontSize: '11px', color: '#666' }}>
          {errors.length === 0 ? 'Level is valid' : 'Fix errors to proceed'}
        </span>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{ padding: '8px 0' }}>
          <h4 style={{
            margin: '0 0 8px',
            padding: '0 16px',
            fontSize: '11px',
            color: '#ef4444',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Errors
          </h4>
          {errors.map((error, index) => (
            <div
              key={`error-${index}`}
              style={{
                padding: '10px 16px',
                borderLeft: '3px solid #ef4444',
                background: index % 2 === 0 ? '#1a0a0a' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <ErrorIcon />
                <div style={{ flex: 1 }}>
                  <div 
                    style={{ 
                      fontSize: '11px', 
                      color: '#888',
                      cursor: onNavigateToField ? 'pointer' : 'default',
                      textDecoration: onNavigateToField ? 'underline' : 'none',
                    }}
                    onClick={() => onNavigateToField?.(error.field)}
                  >
                    {error.field}
                  </div>
                  <div style={{ color: '#fff', marginTop: '2px' }}>
                    {error.error}
                  </div>
                  {error.suggestion && (
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                      → {error.suggestion}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    {canAutoFix(error) && onAutoFix && (
                      <button
                        onClick={() => onAutoFix(error)}
                        style={{
                          padding: '4px 10px',
                          background: '#ef4444',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#fff',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        {getFixLabel(error)}
                      </button>
                    )}
                    {onDismissError && (
                      <button
                        onClick={() => onDismissError(index)}
                        style={{
                          padding: '4px 10px',
                          background: 'transparent',
                          border: '1px solid #444',
                          borderRadius: '4px',
                          color: '#666',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ padding: '8px 0', borderTop: errors.length > 0 ? '1px solid #333' : 'none' }}>
          <h4 style={{
            margin: '0 0 8px',
            padding: '0 16px',
            fontSize: '11px',
            color: '#f59e0b',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Warnings
          </h4>
          {warnings.map((warning, index) => (
            <div
              key={`warning-${index}`}
              style={{
                padding: '10px 16px',
                borderLeft: '3px solid #f59e0b',
                background: (errors.length + index) % 2 === 0 ? '#1f1a0a' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <WarningIcon />
                <div style={{ flex: 1 }}>
                  <div 
                    style={{ 
                      fontSize: '11px', 
                      color: '#888',
                      cursor: onNavigateToField ? 'pointer' : 'default',
                      textDecoration: onNavigateToField ? 'underline' : 'none',
                    }}
                    onClick={() => onNavigateToField?.(warning.field)}
                  >
                    {warning.field}
                  </div>
                  <div style={{ color: '#ccc', marginTop: '2px' }}>
                    {warning.error}
                  </div>
                  {warning.suggestion && (
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                      → {warning.suggestion}
                    </div>
                  )}
                  {onDismissWarning && (
                    <button
                      onClick={() => onDismissWarning(index)}
                      style={{
                        marginTop: '8px',
                        padding: '4px 10px',
                        background: 'transparent',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        color: '#666',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ErrorPanel;
