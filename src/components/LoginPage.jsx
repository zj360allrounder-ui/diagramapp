import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import './LoginPage.css';

export default function LoginPage() {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const isDark = theme === 'dark';

  return (
    <div className="login-page">
      <div className="login-page__bg" aria-hidden />
      <button
        type="button"
        className="login-page__theme theme-toggle"
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <span className="theme-toggle__icon" aria-hidden>
          {isDark ? '☀' : '☽'}
        </span>
        <span>{isDark ? 'Light' : 'Dark'}</span>
      </button>

      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-card__brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>Zarus Diag Studio</h1>
            <p>Sign in to open the diagram workspace</p>
          </div>
        </div>

        <label className="login-card__field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            required
            autoFocus
          />
        </label>

        <label className="login-card__field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </label>

        {error ? (
          <p className="login-card__error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="login-card__submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="login-card__hint">
          Office access requires a server account. Ask your admin if you need credentials.
        </p>
      </form>
    </div>
  );
}
