import type { Metadata } from "next";
import "./globals.css";
import Navigation from './components/navigation';
export const metadata: Metadata = { title: "PS02 · Field evidence", description: "Project evidence, analysis and review with traceable Cloudinary originals." };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to content</a><Navigation /><div id="main-content">{children}</div></body></html>; }
