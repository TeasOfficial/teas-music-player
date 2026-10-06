import { createRoot } from 'react-dom/client'
import App from './App'

import './styles/global.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/pages.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 容器')

// 不使用 StrictMode：开发态的双次 effect 会导致接口重复请求与重复打卡
createRoot(container).render(<App />)
