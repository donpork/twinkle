import './App.css'
import { ResizableGrid } from './components/ResizableGrid'

function App() {
  return (
    <main className="app">
      <header className="intro">
        <h1>particles</h1>
        <p>Fixed preset grid with corner resize handles and pill cells</p>
      </header>
      <div className="sketch-wrap">
        <ResizableGrid />
      </div>
    </main>
  )
}

export default App
