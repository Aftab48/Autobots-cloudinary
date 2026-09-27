import type { NextConfig } from 'next';

// Next blocks dev assets/HMR from other hosts; allow the APP_BASE_URL host (point it at a tunnel for phone testing).
const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.APP_BASE_URL ? [new URL(process.env.APP_BASE_URL).hostname] : [],
};

export default nextConfig;
