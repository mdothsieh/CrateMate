/**
 * main.tsx — React entry point for the renderer (the UI).
 * Mounts <App/> into index.html's #root. Nothing else should ever live here.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
