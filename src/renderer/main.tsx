import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import './styles/globals.css';
import LicenseGate from './components/LicenseGate';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <LicenseGate>
      <RouterProvider router={router} />
    </LicenseGate>
  </React.StrictMode>
);