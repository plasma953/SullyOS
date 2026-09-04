import React from 'react';

export const LoaderDots: React.FC<{ accent?: string; size?: number }> = ({ accent, size }) => {
  const s = size || 6;
  const c = accent || 'currentColor';
  const dot: React.CSSProperties = { width: s, height: s, borderRadius: 9999, background: c };
  return (
    <span className="inline-flex items-center gap-1" aria-label="loading">
      <span style={{ ...dot, animation: 'app-loader-bounce 1.2s ease-in-out infinite' }} />
      <span style={{ ...dot, animation: 'app-loader-bounce 1.2s ease-in-out 0.15s infinite' }} />
      <span style={{ ...dot, animation: 'app-loader-bounce 1.2s ease-in-out 0.3s infinite' }} />
      <style>{`@keyframes app-loader-bounce { 0%,100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }`}</style>
    </span>
  );
};

export default LoaderDots;
