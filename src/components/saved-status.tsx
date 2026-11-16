"use client";

import { useEffect, useState } from "react";

/** Keep the status slot in place so confirming a save never shifts the form. */
export function SavedStatus({ revision }: { revision: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!revision) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(timer);
  }, [revision]);
  return <span className="saved-status" role="status" data-visible={visible || undefined} aria-hidden={!visible}>
    Saved
  </span>;
}
