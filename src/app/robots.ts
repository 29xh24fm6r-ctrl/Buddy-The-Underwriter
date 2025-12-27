import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/login", "/signup", "/sign-in", "/sign-up"],
        disallow: [
          "/deals",
          "/deals/",
          "/admin",
          "/admin/",
          "/portal",
          "/portal/",
          "/banks",
          "/banks/",
          "/ops",
          "/ops/",
          "/settings",
          "/settings/",
          "/upload",
          "/upload/",
          "/share",
          "/share/",
          "/borrower-portal",
          "/borrower-portal/",
          "/committee",
          "/committee/",
          "/underwriting",
          "/underwriting/",
        ],
      },
    ],
    sitemap: "https://www.buddytheunderwriter.com/sitemap.xml",
    host: "https://www.buddytheunderwriter.com",
  };
}
