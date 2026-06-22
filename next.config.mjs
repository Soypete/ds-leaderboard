/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) for the self-host
  // Docker image. Harmless for the Vercel deploy, which ignores it.
  output: 'standalone',
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
