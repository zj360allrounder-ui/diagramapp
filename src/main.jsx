import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ServerWorkspaceProvider } from './context/ServerWorkspaceContext.jsx';
import { HeaderToolbarHostProvider } from './context/HeaderToolbarHostContext.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ServerWorkspaceProvider>
          <HeaderToolbarHostProvider>
            <App />
          </HeaderToolbarHostProvider>
        </ServerWorkspaceProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
);
