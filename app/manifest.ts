import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Saguto Swing Analyzer",
    short_name: "Swing Analyzer",
    description: "Mobiele Stack/Tilt practice companion voor lokale golf swing analyse.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f2",
    theme_color: "#2f7d4f",
    orientation: "any",
    categories: ["sports", "utilities"]
  };
}
