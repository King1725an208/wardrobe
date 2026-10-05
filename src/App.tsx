import { useEffect, useState } from 'react'
import { useStore } from './store'
import Wardrobe from './pages/Wardrobe'
import AddItem from './pages/AddItem'
import Today from './pages/Today'
import SettingsPage from './pages/Settings'
import ItemDetail from './pages/ItemDetail'

export type Page = 'wardrobe' | 'today' | 'add' | 'settings'

export default function App() {
  const { loaded, load } = useStore()
  const [page, setPage] = useState<Page>('wardrobe')
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [load])

  if (!loaded) return <div className="center">加载中…</div>

  return (
    <div className="app">
      <main>
        {detailId ? (
          <ItemDetail id={detailId} onBack={() => setDetailId(null)} />
        ) : page === 'wardrobe' ? (
          <Wardrobe onOpen={setDetailId} />
        ) : page === 'today' ? (
          <Today />
        ) : page === 'add' ? (
          <AddItem onDone={() => setPage('wardrobe')} />
        ) : (
          <SettingsPage />
        )}
      </main>
      {!detailId && (
        <nav className="tabbar">
          <button className={page === 'wardrobe' ? 'on' : ''} onClick={() => setPage('wardrobe')}>
            衣柜
          </button>
          <button className={page === 'today' ? 'on' : ''} onClick={() => setPage('today')}>
            今日穿搭
          </button>
          <button className={page === 'add' ? 'on' : ''} onClick={() => setPage('add')}>
            ＋录入
          </button>
          <button className={page === 'settings' ? 'on' : ''} onClick={() => setPage('settings')}>
            设置
          </button>
        </nav>
      )}
    </div>
  )
}
