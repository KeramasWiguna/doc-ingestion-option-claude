import ChatAppLoader from "@/app/components/ChatAppLoader";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <div className="flex w-full flex-1 flex-col items-center bg-white px-4 dark:bg-black">
        <ChatAppLoader />
      </div>
    </div>
  );
}
