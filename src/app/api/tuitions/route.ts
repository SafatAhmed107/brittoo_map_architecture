import { NextRequest, NextResponse } from 'next/server';
import { getTuitions, createTuition } from '@/lib/db';
import { invalidateAffectedTiles } from '@/lib/cloudflare';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get('lat') ? parseFloat(searchParams.get('lat')!) : undefined;
    const lng = searchParams.get('lng') ? parseFloat(searchParams.get('lng')!) : undefined;
    const radiusMeters = searchParams.get('radius') ? parseFloat(searchParams.get('radius')!) : undefined;
    const status = searchParams.get('status') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;

    const data = await getTuitions({ lat, lng, radiusMeters, status, limit });

    return NextResponse.json({
      success: true,
      count: data.posts.length,
      isLiveDb: data.isLiveDb,
      posts: data.posts
    });
  } catch (error: unknown) {
    console.error('Error fetching tuitions:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.class_level || !body.subjects || !body.salary_budget || body.lat === undefined || body.lng === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: class_level, subjects, salary_budget, lat, lng' },
        { status: 400 }
      );
    }

    const { post, isLiveDb } = await createTuition({
      guardian_name: body.guardian_name,
      contact_number: body.contact_number,
      class_level: body.class_level,
      subjects: Array.isArray(body.subjects) ? body.subjects : [body.subjects],
      salary_budget: parseFloat(body.salary_budget),
      notes: body.notes,
      thana_name: body.thana_name || 'Dhaka',
      district_name: body.district_name || 'Dhaka',
      lat: parseFloat(body.lat),
      lng: parseFloat(body.lng)
    });

    // Breakthrough 3.4: Surgical Cache Invalidation at Cloudflare / Edge
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const origin = req.headers.get('origin') || (host ? `${proto}://${host}` : 'https://api.tuitionmedia.com');
    const invalidation = await invalidateAffectedTiles(post.lng, post.lat, origin);

    return NextResponse.json(
      {
        success: true,
        isLiveDb,
        post,
        invalidation
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('Error creating tuition post:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
