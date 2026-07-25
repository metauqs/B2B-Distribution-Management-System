import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  // Allow all pages, public paths, and static assets to load directly without edge cookie drops
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
