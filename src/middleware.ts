// Two small jobs on every request:
//
// 1. Health checks. Dev tools and load balancers poll `HEAD /` to learn whether
//    the server is up; the login guard would answer 307 (redirect to /login),
//    which some pollers never count as "ready" — the Claude desktop preview
//    pane then re-opens the root URL on a timeout, reloading whatever page the
//    user was on. A bare 200 for HEAD says "up" without touching auth.
// 2. Tell server components which URL they are rendering (x-pathname), so a
//    session that has ended can send the user to /login?next=<here> and bring
//    them straight back afterwards instead of dumping them on the dashboard.
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  if (req.method === 'HEAD') return new NextResponse(null, { status: 200 });
  const headers = new Headers(req.headers);
  headers.set('x-pathname', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
