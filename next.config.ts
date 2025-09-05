import type { NextConfig } from "next";
import os from 'os';
const localIPv4s = Array.from(
  new Set(
    Object.values(os.networkInterfaces())
      .flatMap(ifc => (ifc || []).filter(d => d && d.family === 'IPv4' && !d.internal).map(d => d.address))
  )
);

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'local-origin.dev',
    '192.168.178.80', 
    ...localIPv4s,
  ],
};

export default nextConfig;
