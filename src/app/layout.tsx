import type { Metadata } from "next";
import { BackgroundMusic } from "@/components/background-music";
import { SiteHeader } from "@/components/site-header";
import { UploadTaskProvider } from "@/components/upload-task-provider";
import { copy } from "@/i18n/zh-CN";
import { isOwner } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: copy.metadata.title,
  description: copy.metadata.description,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const owner = await isOwner();
  return (
    <html lang="zh-CN">
      <body>
        <UploadTaskProvider>
          <SiteHeader owner={owner} />
          <main>{children}</main>
          <footer className="site-footer">
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
              京ICP备202604286号-1
            </a>
          </footer>
          <BackgroundMusic />
        </UploadTaskProvider>
      </body>
    </html>
  );
}
