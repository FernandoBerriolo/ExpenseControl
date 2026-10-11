'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BuildingIcon, UsersIcon, WalletIcon } from './Icons'

const ITEMS = [
  { href: '/dashboard', label: 'Gastos',      Icon: WalletIcon },
  { href: '/shared',    label: 'Compartidos', Icon: UsersIcon },
  { href: '/alquiler',  label: 'Apartamento', Icon: BuildingIcon },
]

export default function BottomNav() {
  const pathname = usePathname() ?? ''
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed bottom-0 inset-x-0 z-30 border-t border-line safe-bottom"
      style={{ background: 'color-mix(in srgb, var(--surface) 92%, transparent)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
    >
      <div className="max-w-lg mx-auto grid grid-cols-3 pt-1.5">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className="flex flex-col items-center gap-0.5 py-1.5 text-[11px] font-semibold transition-colors"
              style={{ color: active ? 'var(--primary)' : 'var(--muted-2)' }}
            >
              <span
                className="flex items-center justify-center w-12 h-7 rounded-full transition-colors"
                style={{ background: active ? 'var(--primary-soft)' : 'transparent' }}
              >
                <Icon size={21} />
              </span>
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
