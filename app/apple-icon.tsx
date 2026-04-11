import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{
        width: 180, height: 180,
        background: 'linear-gradient(135deg, #10b981, #059669)',
        borderRadius: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 100,
      }}>
        💰
      </div>
    ),
    { ...size }
  )
}
