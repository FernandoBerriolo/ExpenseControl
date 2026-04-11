import { ImageResponse } from 'next/og'

export const size = { width: 192, height: 192 }
export const contentType = 'image/png'

export default function Icon2() {
  return new ImageResponse(
    (
      <div style={{
        width: 192, height: 192,
        background: 'linear-gradient(135deg, #10b981, #059669)',
        borderRadius: 36,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 106,
      }}>
        💰
      </div>
    ),
    { ...size }
  )
}
