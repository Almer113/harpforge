import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { preloadAudio } from './audio/engine';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The audio engine loads separately; fetch it once the page has drawn, so the first note is instant.
const idle = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
if (idle) idle(preloadAudio, { timeout: 1500 });
else setTimeout(preloadAudio, 500);
