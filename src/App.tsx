import './App.css'
import { ResizableGrid } from './components/ResizableGrid'

function App() {
  return (
    <main className="app">
      <header className="intro">
        <h1>twinkle</h1>
        <p>React + TypeScript + p5 WebGL · drag the seams to resize</p>
      </header>
      <div className="sketch-wrap">
        <ResizableGrid />
      </div>
    </main>
  )
}

export default App
