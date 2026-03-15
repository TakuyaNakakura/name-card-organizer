import { redirect } from "next/navigation";

import { requirePageSession } from "@/lib/http";

export default async function HomePage() {
  await requirePageSession("/scan");
  redirect("/scan");
}
