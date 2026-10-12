import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DevHostApp } from './app';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing in dev-host/index.html');

createRoot(container).render(
  <StrictMode>
    <DevHostApp />
  </StrictMode>
);
