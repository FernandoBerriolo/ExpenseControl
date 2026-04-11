import { ImageResponse } from 'next/og'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{
        width: 512, height: 512,
        background: 'linear-gradient(135deg, #10b981, #059669)',
        borderRadius: 96,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 280,
      }}>
        💰
      </div>
    ),
    { ...size }
  )
}
