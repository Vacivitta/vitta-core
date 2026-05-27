import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/layout/AppShell'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Vitta Core CRM',
  description: 'CRM Comercial Vitta',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className={`${inter.className} bg-gray-100 antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}
