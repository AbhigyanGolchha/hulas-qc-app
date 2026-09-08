// The plant runs on Nepal Time (GMT+5:45). Pin the whole Node process to it so
// "today", calendar dates stored as local midnight, and every timestamp agree
// no matter which machine (or cloud region) hosts the app. This file loads
// before any app code, for `next dev`, `next build` and `next start` alike.
process.env.TZ = 'Asia/Kathmandu';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
