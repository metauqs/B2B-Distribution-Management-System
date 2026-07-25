import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse, ApiError } from '@/types/common';

// ─── Standard API Response Helpers ───────────────────────────────────────────

export function successResponse<T>(
  data: T,
  message?: string,
  status = 200,
  cacheMaxAge?: number
): NextResponse {
  const body: ApiResponse<T> = { success: true, data, message };
  const headers =
    cacheMaxAge != null
      ? { 'Cache-Control': `private, max-age=${cacheMaxAge}, stale-while-revalidate=60` }
      : undefined;
  return NextResponse.json(body, { status, headers });
}

export function createdResponse<T>(data: T, message = 'Created successfully'): NextResponse {
  return successResponse(data, message, 201);
}

export function errorResponse(
  error: string,
  statusCode = 500,
  details?: Record<string, string[]>
): NextResponse {
  const body: ApiError = { success: false, error, statusCode, details };
  return NextResponse.json(body, { status: statusCode });
}

export function notFoundResponse(resource = 'Resource'): NextResponse {
  return errorResponse(`${resource} not found`, 404);
}

export function unauthorizedResponse(message = 'Unauthorized'): NextResponse {
  return errorResponse(message, 401);
}

export function forbiddenResponse(message = 'Forbidden'): NextResponse {
  return errorResponse(message, 403);
}

export function validationErrorResponse(details: Record<string, string[]>): NextResponse {
  return errorResponse('Validation failed', 422, details);
}

// ─── Pagination Helper ────────────────────────────────────────────────────────

export function getPaginationParams(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const skip = (page - 1) * limit;
  const search = searchParams.get('search') ?? undefined;
  const branchId = searchParams.get('branchId') ?? undefined;
  const dateFrom = searchParams.get('dateFrom') ?? undefined;
  const dateTo = searchParams.get('dateTo') ?? undefined;
  const sortBy = searchParams.get('sortBy') ?? 'createdAt';
  const sortOrder = (searchParams.get('sortOrder') ?? 'asc') as 'asc' | 'desc';

  return { page, limit, skip, search, branchId, dateFrom, dateTo, sortBy, sortOrder };
}

// ─── Error Handler ────────────────────────────────────────────────────────────

export function handleApiError(error: unknown): NextResponse {
  console.error('[API Error]', error);

  if (error instanceof Error) {
    // Prisma known errors
    if ('code' in error) {
      const prismaError = error as { code: string; meta?: { target?: string[] } };
      if (prismaError.code === 'P2002') {
        const field = prismaError.meta?.target?.[0] ?? 'field';
        return errorResponse(`${field} already exists`, 409);
      }
      if (prismaError.code === 'P2025') {
        return notFoundResponse();
      }
    }
    return errorResponse(error.message, 500);
  }

  return errorResponse('An unexpected error occurred', 500);
}
