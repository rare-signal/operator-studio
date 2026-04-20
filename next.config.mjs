/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: process.env.NODE_ENV !== "production",
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
}

export default nextConfig
