import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';
import { PwaPrompt } from './pwa/PwaPrompt';
import './features/offline/offline.css';
// El tema municipal va al final: solo cambia el aspecto de las clases de arriba.
import './tema-municipal.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <PwaPrompt />
  </React.StrictMode>
);
