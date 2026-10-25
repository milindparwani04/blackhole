import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import { applyTheme, savedTheme } from './theme';
import { applyFont, savedFont } from './fonts';

applyTheme(savedTheme());
applyFont(savedFont());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
