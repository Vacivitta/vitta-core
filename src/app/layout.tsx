import type { Metadata } from 'next'
import { Nunito } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/layout/AppShell'

const nunito = Nunito({
  variable: '--font-nunito',
  subsets: ['latin'],
  weight: ['400', '600', '700', '800', '900'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'VittaDesk',
  description: 'CRM Comercial VittaDesk',
  icons: {
    icon: '/logo-vacivitta-sidebar.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className={`${nunito.variable} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
