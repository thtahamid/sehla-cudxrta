import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true
};

export default nextConfig;

module.exports = {
  allowedDevOrigins: ['192.168.0.151'],
}