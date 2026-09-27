import type { NextConfig } from 'next';

// Phones open the dev server through the ngrok tunnel (APP_BASE_URL); Next blocks dev assets/HMR from other hosts.
const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.APP_BASE_URL ? [new URL(process.env.APP_BASE_URL).hostname] : [],
};

export default nextConfig;
