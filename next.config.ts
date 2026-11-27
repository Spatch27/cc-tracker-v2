import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./drizzle/**/*"],
  },
};

export default nextConfig;
