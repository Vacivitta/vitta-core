import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/layout/AppShell'

const plusJakarta = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Vitta Core CRM',
  description: 'CRM Comercial Vitta',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className={`${plusJakarta.variable} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
