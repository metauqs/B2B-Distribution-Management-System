import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = 'http://127.0.0.1:3001';

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handleProxy(request, path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handleProxy(request, path);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handleProxy(request, path);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handleProxy(request, path);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handleProxy(request, path);
}

async function handleProxy(request: NextRequest, path: string[]) {
  const pathStr = (path || []).join('/');
  const searchParams = request.nextUrl.search;
  const targetUrl = `${BACKEND_URL}/api/${pathStr}${searchParams}`;

  try {
    const method = request.method;
    const body = ['GET', 'HEAD'].includes(method) ? undefined : await request.arrayBuffer();

    const reqHeaders = new Headers(request.headers);
    reqHeaders.delete('host');
    reqHeaders.delete('connection');

    const res = await fetch(targetUrl, {
      method,
      headers: reqHeaders,
      body,
    });

    const resHeaders = new Headers(res.headers);

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    });
  } catch (err: any) {
    console.error(`[API PROXY ERROR] ${targetUrl}:`, err);
    return NextResponse.json(
      { success: false, error: 'Backend server connection error' },
      { status: 502 }
    );
  }
}
