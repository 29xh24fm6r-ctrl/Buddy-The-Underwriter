import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.buddytheunderwriter.com";

  // Only public marketing URLs
  return [
    { 
      url: `${base}/`, 
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    { 
      url: `${base}/pricing`, 
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    { 
      url: `${base}/login`, 
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    { 
      url: `${base}/signup`, 
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
