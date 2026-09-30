import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultSiteUrl = "https://sait-madmuaziel-niks-final.pages.dev";
const configuredSiteUrl = process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? defaultSiteUrl;
const siteUrl = new URL(configuredSiteUrl).toString().replace(/\/$/, "");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(scriptDir, "../artifacts/nyx-dnd-site/dist/public");
const files = ["index.html", "robots.txt", "sitemap.xml"];

await Promise.all(
  files.map(async (file) => {
    const filePath = path.join(publicDir, file);
    const content = await readFile(filePath, "utf8");
    await writeFile(filePath, content.replaceAll("__SITE_URL__", siteUrl), "utf8");
  }),
);

console.log(`SEO URLs configured for ${siteUrl}`);
