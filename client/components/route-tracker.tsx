"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { SELF_CONTAINED, useReturnTo } from "@/stores/return-to-store";

/** Records every regular page visited (path + query) as the place to return to. */
export function RouteTracker() {
  const pathname = usePathname();
  const setReturnTo = useReturnTo((s) => s.setReturnTo);

  useEffect(() => {
    if (SELF_CONTAINED.some((re) => re.test(pathname))) return;
    setReturnTo(pathname + window.location.search);
  }, [pathname, setReturnTo]);

  return null;
}
