import DiagramCanvas from './components/DiagramCanvas.jsx';
import './App.css';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <h1>Cloud Diagram Studio</h1>
            <p>Architecture &amp; dependency maps with cloud and Kubernetes icons</p>
          </div>
        </div>
      </header>
      <main className="app-main">
        <DiagramCanvas />
      </main>
    </div>
  );
}
