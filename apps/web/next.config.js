/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['sql.js', 'bcryptjs'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({ 'sql.js': 'commonjs sql.js', bcryptjs: 'commonjs bcryptjs' });
    }
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.hdslb.com' },
      { protocol: 'https', hostname: '**.bilibili.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/pet-assets/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, s-maxage=31536000, immutable',
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
