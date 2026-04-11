'use client'
import { useEffect, useState } from 'react'

export default function PWAInstallPrompt() {
  const [showIOSHint, setShowIOSHint] = useState(false)

  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches
    const dismissed = localStorage.getItem('pwa-ios-hint-dismissed')
    if (isIOS && !isInStandaloneMode && !dismissed) {
      setShowIOSHint(true)
    }
  }, [])

  if (!showIOSHint) return null

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: '#1f2937', color: 'white',
      padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px',
      boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
    }}>
      <span style={{ fontSize: 28 }}>📲</span>
      <div style={{ flex: 1, fontSize: 14, lineHeight: 1.4 }}>
        <strong>Instalá la app</strong><br />
        Tocá <strong>compartir</strong> <span style={{ fontSize: 16 }}>⎋</span> y luego{' '}
        <strong>"Agregar a pantalla de inicio"</strong>
      </div>
      <button
        onClick={() => {
          localStorage.setItem('pwa-ios-hint-dismissed', '1')
          setShowIOSHint(false)
        }}
        style={{
          background: 'none', border: 'none', color: '#9ca3af',
          fontSize: 22, cursor: 'pointer', padding: '4px',
        }}
      >✕</button>
    </div>
  )
}
