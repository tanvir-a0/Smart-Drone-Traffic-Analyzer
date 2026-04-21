/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow all local network IPs for HMR
  allowedDevOrigins: ['192.168.0.220', '192.168.2.103', 'localhost']
};

export default nextConfig;
