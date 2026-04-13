import DiagramCanvas from './components/DiagramCanvas.jsx';
import { useTheme } from './context/ThemeContext.jsx';
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

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>jarus Diagram</h1>
            <p>Architecture &amp; dependency maps with cloud and Kubernetes icons</p>
          </div>
        </div>
        <div className="app-header__actions">
          <ThemeToggle />
        </div>
      </header>
      <main className="app-main">
        <DiagramCanvas />
      </main>
    </div>
  );
}
