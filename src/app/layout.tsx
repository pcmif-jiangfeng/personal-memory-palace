import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { UploadTaskProvider } from "@/components/upload-task-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "人生长廊 · Personal Memory Palace",
  description: "一座保存自己人生的现代数字博物馆。",
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
