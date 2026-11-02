import { useEffect, useState } from "react";

import { bridge, type Saved } from "@/utils/bridge/bridge";

export function useSaved(pull: string): Saved[] | null {
  const [records, setRecords] = useState<{ pull: string; list: Saved[] } | null>(null);
  useEffect(() => {
    let asked = 0;
    let live = true;
    const load = () => {
      const mine = ++asked;
      bridge
        .aiSaved(pull)
        .then((list) => {
          if (live && mine === asked) setRecords({ pull, list });
        })
        .catch(() => {});
    };
    load();
    const off = bridge.on<string>("ai-saved", (changed) => {
      if (changed === pull) load();
    });
    return () => {
      live = false;
      off();
    };
  }, [pull]);
  return records?.pull === pull ? records.list : null;
}
