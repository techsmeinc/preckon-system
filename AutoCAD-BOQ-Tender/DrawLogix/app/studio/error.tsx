"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Route error boundary — keeps a client exception from becoming a dead page. */
export default function StudioError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("BIM Studio error:", error);
  }, [error]);

  return (
    <div className="grid h-full place-items-center bg-[#0d1017] p-6 text-slate-200">
      <div className="max-w-md text-center">
        <p className="text-4xl">⚠️</p>
        <h1 className="mt-2 text-lg font-semibold">The BIM Studio hit an error</h1>
        <p className="mt-1 text-sm text-slate-400">Something in the current model couldn’t be drawn. You can retry, or start a fresh model.</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button type="button" onClick={reset} className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400">
            Retry
          </button>
          <button type="button" onClick={() => location.reload()} className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10">
            Reload (fresh model)
          </button>
          <Link href="/projects" className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10">
            Projects
          </Link>
        </div>
        {error?.digest && <p className="mt-3 text-[11px] text-slate-600">ref: {error.digest}</p>}
      </div>
    </div>
  );
}
