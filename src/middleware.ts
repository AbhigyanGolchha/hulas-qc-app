// Health checks. Dev tools and load balancers poll `HEAD /` to learn whether
// the server is up; the login guard would answer 307 (redirect to /login),
// which some pollers never count as "ready" — the Claude desktop preview pane
// then re-opens the root URL on a timeout, reloading whatever page the user was
// on. A bare 200 for HEAD says "up" without touching auth or rendering.
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  if (req.method === 'HEAD') return new NextResponse(null, { status: 200 });
  return NextResponse.next();
}

export const config = { matcher: ['/', '/login'] };
