/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle for the self-hosted Docker image.
  // Vercel performs its own output tracing and packaging.
  output: process.env.VERCEL ? undefined : 'standalone',
  // Media is served from Supabase Storage; allow its public bucket host for
  // <Image> (set NEXT_PUBLIC_SUPABASE_URL's host here once the project exists).
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
