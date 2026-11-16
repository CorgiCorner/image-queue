"use client";

import { useState } from "react";
import { fitIcon } from "morphicons";
import { MorphIcon, type IconInput } from "morphicons/react";
import { FolderSimple, Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

// Filled contours from the existing Phosphor regular icons, normalized for morphing.
// Keep these as static paths: rendering hook-based icons outside React breaks SSR.
const filledIcon = (path: string): IconInput => [["path", {
  d: fitIcon(path, [0, 0, 256, 256]), fill: "currentColor", stroke: "none",
}]];
const imagePath = filledIcon("M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z");
const stackPath = filledIcon("M230.91,172A8,8,0,0,1,228,182.91l-96,56a8,8,0,0,1-8.06,0l-96-56A8,8,0,0,1,36,169.09l92,53.65,92-53.65A8,8,0,0,1,230.91,172ZM220,121.09l-92,53.65L36,121.09A8,8,0,0,0,28,134.91l96,56a8,8,0,0,0,8.06,0l96-56A8,8,0,1,0,220,121.09ZM24,80a8,8,0,0,1,4-6.91l96-56a8,8,0,0,1,8.06,0l96,56a8,8,0,0,1,0,13.82l-96,56a8,8,0,0,1-8.06,0l-96-56A8,8,0,0,1,24,80Zm23.88,0L128,126.74,208.12,80,128,33.26Z");

export function ProductStage() {
  const [versions, setVersions] = useState(false);
  return <div className="product-stage" aria-label="Interactive gallery preview">
    <div className="stage-toolbar">
      <span><FolderSimple size={18} /> Material studies <span className="stage-count">12</span></span>
      <Button variant="outline" onClick={() => setVersions(v => !v)} aria-pressed={versions} className="stage-toggle">
        <MorphIcon icon={versions ? stackPath : imagePath} size={18} reducedMotion="user" />
        {versions ? "Versions" : "Gallery"}
      </Button>
    </div>
    <div className="stage-images" data-versions={versions}>
      {[1,3,5,4,11,6].map((n,i) => <div className="stage-image" key={n}><img src={`${process.env.NEXT_PUBLIC_WEBSITE_BASE_PATH ?? ""}/showcase/${String(n).padStart(2,"0")}.webp`} alt={["Transparent camera","Amber glass lamp","Mechanical toucan","Gradient sculpture","Emerald sculpture","Geometric hummingbird"][i]} /><span className="version-chip">2 versions</span></div>)}
    </div>
    <div className="stage-composer"><span>Make the glass amber. Keep everything else.</span><span className="stage-done"><Check size={16} /> Saved to project</span></div>
  </div>;
}

export function VersionStudy() {
  const [second, setSecond] = useState(false);
  return <div className="version-study">
    <div className="version-study-image"><img src={`${process.env.NEXT_PUBLIC_WEBSITE_BASE_PATH ?? ""}/showcase/${second ? "01" : "01-alt"}.webp`} alt={second ? "Transparent camera on a bronze stand" : "Transparent camera above a plinth"} /></div>
    <div className="version-study-controls"><span>Every idea has a next version.</span><Button variant="outline" onClick={()=>setSecond(v=>!v)} aria-label="Switch example version"><MorphIcon icon={second ? stackPath : imagePath} size={18} reducedMotion="user" />{second ? "Version 2" : "Version 1"}</Button></div>
  </div>;
}
