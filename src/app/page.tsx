"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Redirect to /customer as the default page
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/customer");
  }, [router]);
  return null;
}