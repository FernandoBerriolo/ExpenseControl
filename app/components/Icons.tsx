// Íconos de trazo (24x24, currentColor). Sin dependencias.
type P = { className?: string; size?: number }

function Svg({ children, className, size = 22 }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const WalletIcon = (p: P) => (
  <Svg {...p}><path d="M20 7H5a2 2 0 0 1 0-4h13v4Z" /><path d="M3 5v14a2 2 0 0 0 2 2h15V7" /><circle cx="16.5" cy="14" r="1.2" fill="currentColor" stroke="none" /></Svg>
)
export const UsersIcon = (p: P) => (
  <Svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 4.8a3.2 3.2 0 0 1 0 6.4" /><path d="M18 14.8c1.8.7 3 2.4 3 5.2" /></Svg>
)
export const BuildingIcon = (p: P) => (
  <Svg {...p}><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" /><path d="M14 10h5a1 1 0 0 1 1 1v10" /><path d="M2 21h20" /><path d="M8 8h2M8 12h2M8 16h2" /></Svg>
)
export const LinkIcon = (p: P) => (
  <Svg {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Svg>
)
export const LogoutIcon = (p: P) => (
  <Svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></Svg>
)
export const PlusIcon = (p: P) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
)
export const ChevronLeftIcon = (p: P) => (
  <Svg {...p}><path d="M15 18l-6-6 6-6" /></Svg>
)
export const ChevronRightIcon = (p: P) => (
  <Svg {...p}><path d="M9 18l6-6-6-6" /></Svg>
)
export const ChevronDownIcon = (p: P) => (
  <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>
)
export const CloseIcon = (p: P) => (
  <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>
)
export const EditIcon = (p: P) => (
  <Svg {...p}><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="M14 7l3 3" /></Svg>
)
export const TrashIcon = (p: P) => (
  <Svg {...p}><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V4h6v3" /></Svg>
)
export const CardIcon = (p: P) => (
  <Svg {...p}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /><path d="M6.5 15h3" /></Svg>
)
export const CashIcon = (p: P) => (
  <Svg {...p}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6 9.5v.01M18 14.5v.01" /></Svg>
)
export const CalendarIcon = (p: P) => (
  <Svg {...p}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Svg>
)
export const ArrowUpIcon = (p: P) => (
  <Svg {...p}><path d="M12 19V5M6 11l6-6 6 6" /></Svg>
)
export const PiggyIcon = (p: P) => (
  <Svg {...p}><path d="M19 11.5c0-3-2.7-5-6-5-3.9 0-7 2.4-7 6 0 1.8.8 3.2 2 4.2V20h3v-1.5h3V20h3v-3.3c.9-.6 1.6-1.4 2-2.4H22v-3.3l-3 .5Z" /><circle cx="15.5" cy="11.5" r=".8" fill="currentColor" stroke="none" /></Svg>
)
export const BriefcaseIcon = (p: P) => (
  <Svg {...p}><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></Svg>
)
