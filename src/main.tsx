import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { preloadAudio } from './audio/engine';
import { preloadFormats } from './state/actions';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The audio engine and the format readers load separately; fetch them once the page has
// drawn, so the first note is instant and an export downloads right from the click.
const preload = () => {
  preloadAudio();
  preloadFormats();
};
const idle = (window as Window & { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
if (idle) idle(preload, { timeout: 1500 });
else setTimeout(preload, 500);
