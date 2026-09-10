"use client";

import dynamic from "next/dynamic";

// Same reasoning as ChatAppLoader.tsx: reads localStorage synchronously, so
// it can't be server-rendered.
const BenchmarkApp = dynamic(() => import("@/app/components/BenchmarkApp"), {
  ssr: false,
});

export default function BenchmarkAppLoader() {
  return <BenchmarkApp />;
}
