"use client";

import { useState } from "react";
import { fitIcon } from "morphicons";
import { MorphIcon, type IconInput } from "morphicons/react";
import { Image, Stack, FolderSimple, Check } from "@phosphor-icons/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";

// Keep the existing Phosphor family; morphicons consumes path data rather than React components.
const pathOf = (element: React.ReactElement) => [...renderToStaticMarkup(element).matchAll(/<path[^>]* d="([^"]+)"/g)].map(m => m[1]).join(" ");
// Phosphor outlines are filled contours, not stroked centerlines.
const filledIcon = (element: React.ReactElement): IconInput => [["path", {
  d: fitIcon(pathOf(element), [0, 0, 256, 256]), fill: "currentColor", stroke: "none",
}]];
const imagePath = filledIcon(<Image />), stackPath = filledIcon(<Stack />);

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
      {[1,3,5,4,11,6].map((n,i) => <div className="stage-image" key={n}><img src={`/showcase/${String(n).padStart(2,"0")}.webp`} alt={["Transparent camera","Amber glass lamp","Mechanical toucan","Gradient sculpture","Emerald sculpture","Geometric hummingbird"][i]} /><span className="version-chip">2 versions</span></div>)}
    </div>
    <div className="stage-composer"><span>Make the glass amber. Keep everything else.</span><span className="stage-done"><Check size={16} /> Saved to project</span></div>
  </div>;
}

export function VersionStudy() {
  const [second, setSecond] = useState(false);
  return <div className="version-study">
    <div className="version-study-image"><img src={`/showcase/${second ? "01" : "01-alt"}.webp`} alt={second ? "Transparent camera on a bronze stand" : "Transparent camera above a plinth"} /></div>
    <div className="version-study-controls"><span>Every idea has a next version.</span><Button variant="outline" onClick={()=>setSecond(v=>!v)} aria-label="Switch example version"><MorphIcon icon={second ? stackPath : imagePath} size={18} reducedMotion="user" />{second ? "Version 2" : "Version 1"}</Button></div>
  </div>;
}
