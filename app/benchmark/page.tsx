import Link from "next/link";
import BenchmarkAppLoader from "@/app/components/BenchmarkAppLoader";

export default function BenchmarkPage() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <div className="flex w-full flex-1 flex-col items-center bg-white dark:bg-black">
        <div className="w-full max-w-5xl px-4 pt-4">
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← Back to chat
          </Link>
        </div>
        <BenchmarkAppLoader />
      </div>
    </div>
  );
}
