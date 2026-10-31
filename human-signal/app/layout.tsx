import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HUMAN SIGNAL — AI Training Party Game",
  description: "Train the AI. Outsmart the Bots. Become the Human Expert."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
