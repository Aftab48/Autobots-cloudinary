import type { Metadata } from "next";
import "./globals.css";
import Navigation from './components/navigation';
import { getProjectSelection } from '../lib/active-project';
export const metadata: Metadata = { title: "PS02 · Field evidence", description: "Project evidence, analysis and review with traceable Cloudinary originals." };
export default async function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  let selection: { projects: Record<string, any>[]; project: Record<string, any> | null } = { projects: [], project: null };
  let unavailable = false;
  try { selection = await getProjectSelection(); } catch { unavailable = true; }
  return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to content</a><Navigation projects={selection.projects.map(({ id, name }) => ({ id, name }))} selectedId={selection.project?.id} unavailable={unavailable} /><div id="main-content">{children}</div></body></html>;
}
