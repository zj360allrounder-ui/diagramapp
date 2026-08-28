import DiagramCanvas from './components/DiagramCanvas.jsx';
import LoginPage from './components/LoginPage.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { useTheme } from './context/ThemeContext.jsx';
import { useHeaderToolbarHost } from './context/HeaderToolbarHostContext.jsx';
import './App.css';

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={!isDark}
      title={isDark ? 'Use light theme' : 'Use dark theme'}
    >
      <span className="theme-toggle__icon" aria-hidden>
        {isDark ? '☀' : '☽'}
      </span>
      <span>{isDark ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function AuthBootSplash() {
  return (
    <div className="auth-boot">
      <p>Checking session…</p>
    </div>
  );
}

function StudioShell() {
  const { setMount } = useHeaderToolbarHost();
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>Zarus Diag Studio</h1>
            <p>Architecture &amp; dependency maps with cloud and Kubernetes icons</p>
          </div>
        </div>
        <div className="app-header__toolbar-mount" ref={setMount} />
        <div className="app-header__actions">
          {user?.username ? (
            <span className="app-header__user" title="Signed in">
              {user.username}
            </span>
          ) : null}
          <button type="button" className="theme-toggle" onClick={logout} title="Sign out">
            Sign out
          </button>
          <ThemeToggle />
        </div>
      </header>
      <main className="app-main">
        <DiagramCanvas />
      </main>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, bootstrapping } = useAuth();

  if (bootstrapping) {
    return <AuthBootSplash />;
  }
  if (!isAuthenticated) {
    return <LoginPage />;
  }
  return <StudioShell />;
}
