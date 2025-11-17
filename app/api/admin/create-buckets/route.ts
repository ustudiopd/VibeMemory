import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/admin/create-buckets
 * Storage 버킷 생성 테스트 엔드포인트
 */
export async function POST(request: NextRequest) {
  try {
    const buckets = [
      {
        name: 'project-screenshots',
        public: false,
        fileSizeLimit: 10485760, // 10MB
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      },
      {
        name: 'idea-project-files',
        public: false,
        fileSizeLimit: 10485760, // 10MB
        allowedMimeTypes: ['text/markdown', 'text/plain'],
      },
      {
        name: 'repo-files',
        public: false,
        fileSizeLimit: 10485760, // 10MB
        allowedMimeTypes: ['text/markdown', 'text/plain'],
      },
    ];

    const results = [];

    // 먼저 기존 버킷 목록 확인
    const { data: existingBuckets, error: listError } = await supabaseAdmin.storage.listBuckets();
    
    if (listError) {
      console.error('[CREATE-BUCKETS] Error listing buckets:', listError);
      return NextResponse.json(
        { 
          error: '버킷 목록 조회 실패',
          details: listError.message,
          listError: JSON.stringify(listError, null, 2),
        },
        { status: 500 }
      );
    }

    console.log('[CREATE-BUCKETS] Existing buckets:', existingBuckets?.map(b => b.name).join(', ') || 'none');

    // 각 버킷 생성 시도
    for (const bucketConfig of buckets) {
      const exists = existingBuckets?.some(b => b.name === bucketConfig.name) ?? false;
      
      if (exists) {
        console.log(`[CREATE-BUCKETS] Bucket ${bucketConfig.name} already exists`);
        results.push({
          name: bucketConfig.name,
          status: 'exists',
          message: '이미 존재함',
        });
        continue;
      }

      console.log(`[CREATE-BUCKETS] Creating bucket: ${bucketConfig.name}`);
      const { data, error } = await supabaseAdmin.storage.createBucket(
        bucketConfig.name,
        {
          public: bucketConfig.public,
          fileSizeLimit: bucketConfig.fileSizeLimit,
          allowedMimeTypes: bucketConfig.allowedMimeTypes,
        }
      );

      if (error) {
        console.error(`[CREATE-BUCKETS] Error creating ${bucketConfig.name}:`, error);
        results.push({
          name: bucketConfig.name,
          status: 'error',
          message: error.message,
          error: JSON.stringify(error, null, 2),
        });
      } else {
        console.log(`[CREATE-BUCKETS] Successfully created: ${bucketConfig.name}`, data);
        results.push({
          name: bucketConfig.name,
          status: 'created',
          message: '생성 완료',
          data,
        });
      }
    }

    // 최종 버킷 목록 확인
    const { data: finalBuckets, error: finalListError } = await supabaseAdmin.storage.listBuckets();
    
    return NextResponse.json({
      success: true,
      results,
      existingBuckets: existingBuckets?.map(b => b.name) || [],
      finalBuckets: finalBuckets?.map(b => b.name) || [],
      finalListError: finalListError ? JSON.stringify(finalListError, null, 2) : null,
    });
  } catch (error) {
    console.error('[CREATE-BUCKETS] Exception:', error);
    return NextResponse.json(
      {
        error: '버킷 생성 중 예외 발생',
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

