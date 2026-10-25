import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { blockBrowserZoom } from './settings';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-500.css';
import './styles/app.css';

blockBrowserZoom();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
