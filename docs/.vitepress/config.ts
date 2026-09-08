import { defineConfig } from "vitepress";

const base = process.env.VITEPRESS_BASE ?? (process.env.GITHUB_ACTIONS ? "/soggfy-cli/" : "/");

export default defineConfig({
  title: "Soggfy",
  description: "CLI and local web UI for supervised Spotify audio capture on macOS.",
  lang: "en-US",
  base,
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/" },
      { text: "CLI", link: "/cli/" },
      { text: "Architecture", link: "/current-architecture" },
    ],
    sidebar: [
      {
        text: "CLI",
        items: [
          { text: "Overview", link: "/cli/" },
          { text: "download", link: "/cli/download" },
          { text: "search", link: "/cli/search" },
          { text: "auth", link: "/cli/auth" },
          { text: "daemon", link: "/cli/daemon" },
          { text: "install", link: "/cli/install" },
          { text: "fingerprint", link: "/cli/fingerprint" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Shell scripting", link: "/guides/scripting" },
          { text: "Configuration", link: "/guides/configuration" },
          { text: "Formats & validation", link: "/guides/formats" },
          { text: "Troubleshooting", link: "/guides/troubleshooting" },
        ],
      },
      {
        text: "Internals",
        items: [
          { text: "Current architecture", link: "/current-architecture" },
          { text: "Known failures", link: "/known-failures" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/rikhoffbauer/soggfy-cli" },
    ],
    search: { provider: "local" },
    outline: { level: [2, 3] },
  },
});
