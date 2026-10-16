import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';
import { PwaPrompt } from './pwa/PwaPrompt';
import './features/offline/offline.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <PwaPrompt />
  </React.StrictMode>
);
