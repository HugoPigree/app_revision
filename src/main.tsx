import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { initDB, repairDB } from './db';
import './lib/sync';
import './styles.css';

registerSW({ immediate: true });

initDB()
  .then(repairDB)
  .catch((e) => console.error('Initialisation de la base locale', e))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
