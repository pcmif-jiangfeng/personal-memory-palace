import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { UploadTaskProvider } from "@/components/upload-task-provider";
import { copy } from "@/i18n/zh-CN";
import "./globals.css";

export const metadata: Metadata = {
  title: copy.metadata.title,
  description: copy.metadata.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <UploadTaskProvider>
          <SiteHeader />
          <main>{children}</main>
        </UploadTaskProvider>
      </body>
    </html>
  );
}
