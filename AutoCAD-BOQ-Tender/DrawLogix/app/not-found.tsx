import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#0d1017] text-center text-slate-200">
      <p className="text-5xl">🗺️</p>
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-slate-400">That page doesn’t exist in this workspace.</p>
      <Link href="/" className="text-sm font-medium text-indigo-300 hover:underline">
        ← Back to the editor
      </Link>
    </div>
  );
}
