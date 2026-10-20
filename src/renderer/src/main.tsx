import { createRoot } from 'react-dom/client'
import App from './components/App'
import './styles.css'

// no macOS a barra superior divide espaço com os botões da janela
document.documentElement.dataset.platform = navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'

createRoot(document.getElementById('root')!).render(<App />)
