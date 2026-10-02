import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import TitleBar from './components/TitleBar.jsx'
import './styles.css'
import './themes-fx.css'
import './titlebar.css'

createRoot(document.getElementById('titlebar')).render(<TitleBar />)
createRoot(document.getElementById('root')).render(<App />)
