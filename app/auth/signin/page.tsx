'use client';

import { signIn } from 'next-auth/react';

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold text-center mb-8">VibeMemory</h1>
        <p className="text-center text-gray-600 mb-8">
          GitHub 계정으로 로그인하여 시작하세요
        </p>
        <div className="flex justify-center">
          <button
            onClick={() => signIn('github', { callbackUrl: '/' })}
            className="px-6 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
          >
            GitHub로 로그인
          </button>
        </div>
      </div>
    </div>
  );
}

