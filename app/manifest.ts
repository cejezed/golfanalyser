import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mijn Swingcoach",
    short_name: "Swingcoach",
    description: "Persoonlijke golf swingcoach voor lokale videoanalyse en gerichte training.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f2",
    theme_color: "#2f7d4f",
    orientation: "any",
    categories: ["sports", "utilities"]
  };
}
