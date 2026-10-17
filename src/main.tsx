import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startAccount } from './account/session';
import { App } from './App';
import { preloadAudio } from './audio/engine';
import { preloadFormats } from './state/actions';
import { startTheme } from './state/theme';
import './styles/index.css';

// This device's theme (index.html has shown it already), and following its changes.
startTheme();

// Whose library: an account's (on the server) or this browser's — asked before it's read.
void startAccount();

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
