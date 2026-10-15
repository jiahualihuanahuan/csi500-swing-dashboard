/** @type {import('next').NextConfig} */
// Rewrites run inside the web container, so this must be the docker service
// name. localhost:8000 inside that container is not the api.
const apiUrl = process.env.API_INTERNAL_URL || 'http://api:8000';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]
  },
}
module.exports = nextConfig
