import "./globals.css"

export const metadata = { title: "Employee Transfer Assistant" }

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}