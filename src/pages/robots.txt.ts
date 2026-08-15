import type { APIRoute } from "astro";

/**
 * Generated rather than static so the sitemap URL always matches the site
 * actually being built — a hardcoded domain here goes stale silently.
 */
export const GET: APIRoute = ({ site }) => {
  const body = `User-agent: *
Allow: /

Sitemap: ${new URL("sitemap-index.xml", site)}
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
