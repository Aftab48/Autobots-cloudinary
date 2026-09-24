'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const pages = [['/', 'Dashboard'], ['/evidence', 'Evidence'], ['/review', 'Review queue'], ['/search', 'Search'], ['/upload', 'Upload']];
export default function Navigation() {
  const pathname = usePathname();
  return <header className="site-header"><div className="site-header-inner"><Link className="site-brand" href="/" aria-label="PS02 project dashboard">PS02<span>Field evidence</span></Link>
    <nav aria-label="Project navigation">{pages.map(([href, title]) => <Link key={href} href={href} aria-current={(href === '/' ? pathname === href : pathname.startsWith(href)) ? 'page' : undefined}>{title}</Link>)}</nav>
  </div></header>;
}
