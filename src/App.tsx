import { useEffect, useRef, useState } from 'react'
import './App.css'

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void
    YT?: typeof YT
    google?: any
  }
}

function App() {
  // OAuth / API 模式（可選）
  const [token, setToken] = useState<string | null>(null)
  // 免設定模式：以播放清單 ID/URL 直接播放（不呼叫 Data API）
  const [playlistInput, setPlaylistInput] = useState<string>('')
  const [playlistId, setPlaylistId] = useState<string>('')
  const [currentTitle, setCurrentTitle] = useState<string>('')
  const [shuffle, setShuffle] = useState<boolean>(false)
  const [clientIdInput, setClientIdInput] = useState<string>(() => localStorage.getItem('yt_client_id') || '')
  const playerRef = useRef<YT.Player | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(() => {
        // noop
      })
    }
  }, [])

  useEffect(() => {
    const existing = localStorage.getItem('yt_token')
    if (existing) setToken(existing)
  }, [])

  useEffect(() => {
    // 嘗試從 base 路徑載入 client_id（可接受兩種格式）
    if (clientIdInput) return
    const url = new URL('google-client.json', import.meta.env.BASE_URL).toString()
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return
        const id =
          j.client_id ||
          j.web?.client_id ||
          j.installed?.client_id ||
          ''
        if (id) {
          setClientIdInput(id)
          try {
            localStorage.setItem('yt_client_id', id)
          } catch {}
        }
      })
      .catch(() => {})
  }, [clientIdInput])

  const login = () => {
    const usedClientId = clientIdInput || clientId
    if (!usedClientId) {
      alert('請先輸入 Client ID 或設定 VITE_GOOGLE_CLIENT_ID')
      return
    }
    const client = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: usedClientId,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      callback: (resp: any) => {
        if (resp?.access_token) {
          setToken(resp.access_token)
          localStorage.setItem('yt_token', resp.access_token)
        }
      },
    })
    client?.requestAccessToken()
  }

  const logout = () => {
    setToken(null)
    localStorage.removeItem('yt_token')
  }

  const fetchMyPlaylists = async () => {
    if (!token) return
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = await res.json()
    const list: { id: string; title: string }[] =
      data.items?.map((p: any) => ({ id: p.id, title: p.snippet.title })) ?? []
    if (!list.length) {
      alert('找不到任何播放清單')
      return
    }
    const chosen = list[0]
    // OAuth 模式下也直接以 playlistId 播放，免再逐首查詢
    setPlaylistId(chosen.id)
  }

  const parsePlaylistId = (input: string) => {
    try {
      // 若直接貼 ID
      if (/^(PL|UU|LL|FL|RD)[A-Za-z0-9_\-]+$/.test(input)) return input
      const url = new URL(input)
      const id = url.searchParams.get('list')
      return id ?? ''
    } catch {
      // 非 URL，且不是標準前綴，也許仍是 ID
      return input.trim()
    }
  }

  useEffect(() => {
    if (!playlistId) return
    const create = () => {
      if (!containerRef.current || !window.YT?.Player) return
      // 如已有播放器則銷毀重建，以切換 playlistId
      if (playerRef.current) {
        try {
          playerRef.current.destroy()
        } catch {}
        playerRef.current = null
      }
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: '0',
        width: '0',
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          listType: 'playlist',
          list: playlistId,
        },
        events: {
          onReady: () => {
            try {
              playerRef.current?.setShuffle?.(shuffle)
              if (shuffle) playerRef.current?.setLoop?.(true)
            } catch {}
            setupMediaSession()
          },
          onStateChange: (e) => {
            if (e.data === window.YT?.PlayerState?.PLAYING) {
              const data = playerRef.current?.getVideoData()
              setCurrentTitle(data?.title ?? '')
              setupMediaSession()
            }
            if (e.data === window.YT?.PlayerState?.ENDED) {
              // 調用 next 由 IFrame 控制下一首
              playerRef.current?.nextVideo()
            }
          },
        },
      })
    }
    if (window.YT?.Player) {
      create()
    } else {
      const t = setInterval(() => {
        if (window.YT?.Player) {
          clearInterval(t)
          create()
        }
      }, 300)
      return () => clearInterval(t)
    }
  }, [playlistId])

  useEffect(() => {
    try {
      playerRef.current?.setShuffle?.(shuffle)
      if (shuffle) playerRef.current?.setLoop?.(true)
    } catch {}
  }, [shuffle])

  const setupMediaSession = () => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTitle || 'YouTube Playlist',
      artist: 'YouTube',
    })
    navigator.mediaSession.setActionHandler('play', () => playerRef.current?.playVideo())
    navigator.mediaSession.setActionHandler('pause', () => playerRef.current?.pauseVideo())
    navigator.mediaSession.setActionHandler('previoustrack', () => playerRef.current?.previousVideo())
    navigator.mediaSession.setActionHandler('nexttrack', () => playerRef.current?.nextVideo())
  }

  const play = () => playerRef.current?.playVideo()
  const pause = () => playerRef.current?.pauseVideo()
  const nextTrack = () => playerRef.current?.nextVideo()
  const prevTrack = () => playerRef.current?.previousVideo()
  const toggleShuffle = () => {
    setShuffle((s) => {
      const next = !s
      try {
        playerRef.current?.setShuffle?.(next)
        if (next) {
          playerRef.current?.setLoop?.(true)
          playerRef.current?.nextVideo?.()
        }
      } catch {}
      return next
    })
  }
  const loadFromInput = () => {
    const id = parsePlaylistId(playlistInput)
    if (!id) {
      alert('請輸入有效的 YouTube 播放清單連結或 ID')
      return
    }
    setPlaylistId(id)
  }

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ marginBottom: 8 }}>YeeMusic Web</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <strong>免設定模式：</strong>貼上 YouTube 播放清單網址或 ID
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ minWidth: 320, padding: 8 }}
            value={playlistInput}
            placeholder="例如：https://www.youtube.com/playlist?list=PLxxxxxxxxx"
            onChange={(e) => setPlaylistInput(e.target.value)}
          />
          <button onClick={loadFromInput}>載入清單</button>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <details>
          <summary>或使用 Google 登入（可讀取私人清單）</summary>
          {!token ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <input
                style={{ minWidth: 360, padding: 8 }}
                value={clientIdInput}
                placeholder="可選：輸入 Google OAuth Client ID（無需密鑰）"
                onChange={(e) => setClientIdInput(e.target.value)}
              />
              <button onClick={login}>使用 Google 登入並授權 YouTube</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button onClick={fetchMyPlaylists}>匯入我的播放清單（預設取第一個）</button>
              <button onClick={logout}>登出</button>
            </div>
          )}
        </details>
      </div>
      <div style={{ marginTop: 16 }}>
        <div id="player" ref={containerRef} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={prevTrack}>上一首</button>
          <button onClick={play}>播放</button>
          <button onClick={pause}>暫停</button>
          <button onClick={nextTrack}>下一首</button>
          <button onClick={toggleShuffle}>{shuffle ? '隨機播放：開' : '隨機播放：關'}</button>
        </div>
        {currentTitle && (
          <div style={{ marginTop: 8, color: '#4ade80' }}>正在播放：{currentTitle}</div>
        )}
      </div>
      <p style={{ marginTop: 16, color: '#888' }}>
        注意：電腦進入睡眠將無法播放。請調整電源設定或安裝為 PWA 並保持系統喚醒。
      </p>
    </div>
  )
}

export default App
