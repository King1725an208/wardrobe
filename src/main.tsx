import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 启动时先用本地缓存的主题上色，避免闪成默认绿
document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'forest'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
