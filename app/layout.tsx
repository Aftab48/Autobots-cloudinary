import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "PS02 · Day-1 checks", description: "Cloudinary account capability checks" };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
