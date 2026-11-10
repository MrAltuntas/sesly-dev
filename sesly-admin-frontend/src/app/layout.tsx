import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sesly Admin | Mission Control",
  description: "Centralized command hub for Sesly AI platform.",
  icons: {
    icon: "/image/seslyio-logo-transparent.png",
    apple: "/image/seslyio-logo-transparent.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={cn(inter.className, "min-h-screen antialiased bg-background")}>
        <AuthProvider>
          {children}
        </AuthProvider>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
